import { Want } from '@kit.AbilityKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { ControlServerConfig, ControlServerSettings } from './ControlServerConfig';
import { DeviceNameService } from './DeviceNameService';
import { DiagnosticEventStore } from './DiagnosticEventStore';
import { VpnCommandGateway } from './VpnCommandGateway';
import { VpnLinkSnapshot, VpnLinkState, VpnStatusReader } from './VpnStatusReader';

const BUNDLE_NAME: string = 'ren.w2h.mesharc';
const VPN_EXTENSION_ABILITY_NAME: string = 'TailscaleVpnExtensionAbility';

// Mirrors the file names the UI path stages, so the extension sees identical
// handoffs whichever entry point the user came from.
const VPN_CONNECT_CONFIG_FILE_NAME: string = 'vpn-connect-config.json';
const VPN_STOP_REQUEST_FILE_NAME: string = 'vpn-stop-request.json';
const VPN_STOP_RESPONSE_FILE_NAME: string = 'vpn-stop-response.json';
const VPN_BACKEND_HANDOFF_REQUEST_FILE_NAME: string = 'vpn-backend-handoff-request.json';
const VPN_BACKEND_HANDOFF_RESPONSE_FILE_NAME: string = 'vpn-backend-handoff-response.json';

const STOP_POLL_INTERVAL_MS: number = 50;
const STOP_POLL_MAX_ATTEMPTS: number = 150;
const BACKEND_READY_POLL_INTERVAL_MS: number = 250;
const BACKEND_READY_MAX_ATTEMPTS: number = 40;
const CONFIG_RETRY_INTERVAL_MS: number = 500;
const CONFIG_MAX_ATTEMPTS: number = 20;
const CONFIG_PENDING_MARKER: string = 'PENDING';
// The extension polls its handoff request for 15s before it destroys the VPN,
// so this side has to keep watching for at least that long.
const BACKEND_HANDOFF_POLL_INTERVAL_MS: number = 250;
const BACKEND_HANDOFF_MAX_ATTEMPTS: number = 60;

interface VpnBackendHandoffRequest {
  requestId: number;
}

interface VpnBackendHandoffResponse {
  requestId: number;
  status: string;
}

export enum VpnActionResult {
  /** The extension was asked to start. */
  STARTED = 'started',
  /** The extension was asked to stop. */
  STOPPED = 'stopped',
  /** Already in the requested state. */
  UNCHANGED = 'unchanged',
  /** Cannot be completed without the UI (login, control server, backend). */
  NEEDS_UI = 'needs_ui',
  /** The caller withdrew its authority before the extension was started. */
  CANCELLED = 'cancelled',
  FAILED = 'failed'
}

/**
 * Headless VPN control for entry points that have no UI, currently the home
 * screen card's `call` event.
 *
 * This intentionally does not reuse BridgeStatus.beginVpnConnection /
 * stopVpnProbe: those are private methods of a ~14,800 line component and are
 * bound to its @State and to getUIContext(). This is a second, smaller path
 * over the same primitives (VpnCommandGateway + the filesystem protocol).
 * Keeping the two in step is tracked as known debt; the file names and the
 * status vocabulary above must not drift apart.
 */
export class VpnSessionController {
  private readonly gateway: VpnCommandGateway = new VpnCommandGateway();

  static vpnWant(): Want {
    return { bundleName: BUNDLE_NAME, abilityName: VPN_EXTENSION_ABILITY_NAME };
  }

  static readLink(filesDir: string): VpnLinkSnapshot {
    return VpnStatusReader.read(filesDir);
  }

  /** True when the user still has to pick and confirm a control server. */
  static needsControlServer(filesDir: string): boolean {
    return !ControlServerConfig.load(filesDir).confirmed;
  }

  /**
   * Starts the tunnel.
   *
   * `cancelled` lets the caller withdraw its authority while this runs. The
   * reconnect supervisor passes one, because a user disconnect that arrives
   * during a reconnect must not end with a tunnel the user just killed. The
   * check sits after the backend wait, which is the long step, and again before
   * the extension starts.
   */
  async connect(filesDir: string, cancelled?: () => boolean): Promise<VpnActionResult> {
    const current: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
    if (current.state === VpnLinkState.CONNECTED) {
      return VpnActionResult.UNCHANGED;
    }
    if (current.state === VpnLinkState.NEEDS_LOGIN) {
      return VpnActionResult.NEEDS_UI;
    }
    const controlServer: ControlServerSettings = ControlServerConfig.load(filesDir);
    if (!controlServer.confirmed) {
      return VpnActionResult.NEEDS_UI;
    }
    try {
      if (!await this.ensureBackendReady(filesDir, controlServer.controlURL)) {
        return VpnActionResult.NEEDS_UI;
      }
      if (cancelled !== undefined && cancelled()) {
        return VpnActionResult.CANCELLED;
      }
      const config: string = await this.requestConnectConfig();
      if (config.startsWith('FAILED') || config.length === 0) {
        return VpnActionResult.NEEDS_UI;
      }
      if (!this.gateway.stageConnectConfig(filesDir, VPN_CONNECT_CONFIG_FILE_NAME, config)) {
        return VpnActionResult.FAILED;
      }
      if (cancelled !== undefined && cancelled()) {
        return VpnActionResult.CANCELLED;
      }
      this.clearHandoffFiles(filesDir);
      await this.gateway.startVpnExtension(VpnSessionController.vpnWant());
      this.record(filesDir, 'vpn_start_requested', 'system');
      // Deliberately not awaited: the extension asks for the handoff a moment
      // later, and the card's call event must not block for that long.
      this.answerBackendHandoff(filesDir).catch(() => {
        // A failure here is already recorded inside the loop.
      });
      return VpnActionResult.STARTED;
    } catch (_error) {
      // The UI can explain a failure; the card cannot.
      return VpnActionResult.FAILED;
    }
  }

  async disconnect(filesDir: string): Promise<VpnActionResult> {
    const current: VpnLinkSnapshot = VpnStatusReader.read(filesDir);
    if (current.state === VpnLinkState.DISCONNECTED) {
      return VpnActionResult.UNCHANGED;
    }
    const requestId: number = Date.now();
    // The extension watches the stop-request file; the empty response first
    // stops a stale reply from being mistaken for this request's answer.
    const staged: boolean =
      this.gateway.writeCommandFile(filesDir, VPN_STOP_RESPONSE_FILE_NAME, '') &&
      this.gateway.writeCommandFile(filesDir, VPN_STOP_REQUEST_FILE_NAME,
        JSON.stringify({ requestId: requestId }));
    if (staged) {
      await this.awaitBackendStop(filesDir, requestId);
    }
    try {
      await this.gateway.stopVpnExtension(VpnSessionController.vpnWant());
      this.record(filesDir, 'vpn_stop_requested', 'system');
      return VpnActionResult.STOPPED;
    } catch (_error) {
      return VpnActionResult.FAILED;
    }
  }

  /**
   * Stops this process's native backend when the extension asks for it, and
   * confirms with the response file the extension is polling.
   *
   * The extension only needs the confirmation - it does not inspect what the
   * backend was doing - but the request and the answer carry a requestId so a
   * stale reply cannot be mistaken for this one's.
   */
  private async answerBackendHandoff(filesDir: string): Promise<void> {
    for (let attempt: number = 0; attempt < BACKEND_HANDOFF_MAX_ATTEMPTS; attempt++) {
      const requestText: string | undefined =
        this.gateway.readCommandFile(filesDir, VPN_BACKEND_HANDOFF_REQUEST_FILE_NAME);
      if (requestText !== undefined && requestText.trim().length > 0) {
        this.gateway.writeCommandFile(filesDir, VPN_BACKEND_HANDOFF_REQUEST_FILE_NAME, '');
        const requestId: number = VpnSessionController.requestIdOf(requestText);
        if (requestId <= 0) {
          this.record(filesDir, 'vpn_backend_handoff_request_invalid', 'vpn_handoff');
          return;
        }
        let status: string = 'FAILED | backend handoff | stop unavailable';
        try {
          status = await this.gateway.stopBackend();
        } catch (_error) {
          // Answering still releases the extension; the tunnel is the goal.
        }
        const response: VpnBackendHandoffResponse = { requestId: requestId, status: status };
        this.gateway.writeCommandFile(filesDir, VPN_BACKEND_HANDOFF_RESPONSE_FILE_NAME,
          JSON.stringify(response));
        this.record(filesDir, status.startsWith('OK') ?
          'vpn_backend_handoff_stopped' : 'vpn_backend_handoff_stop_failed', 'vpn_handoff');
        return;
      }
      await VpnSessionController.sleep(BACKEND_HANDOFF_POLL_INTERVAL_MS);
    }
  }

  private static requestIdOf(requestText: string): number {
    try {
      const request: VpnBackendHandoffRequest = JSON.parse(requestText) as VpnBackendHandoffRequest;
      return request.requestId;
    } catch (_error) {
      return 0;
    }
  }

  private record(filesDir: string, event: string, phase: string): void {
    DiagnosticEventStore.record(filesDir, 'ui', event, phase);
  }

  private async ensureBackendReady(filesDir: string, controlURL: string): Promise<boolean> {
    if (this.backendRunning()) {
      return true;
    }
    try {
      this.gateway.startBackend(`${filesDir}/tailscale`, DeviceNameService.model(),
        VpnSessionController.osVersion(), controlURL);
    } catch (_error) {
      return false;
    }
    for (let attempt: number = 0; attempt < BACKEND_READY_MAX_ATTEMPTS; attempt++) {
      if (this.backendRunning() || this.backendNeedsLogin()) {
        // A backend that wants a login is "ready" in the sense that the UI is
        // now the only way forward; requestConnectConfig reports that below.
        return this.backendRunning();
      }
      await VpnSessionController.sleep(BACKEND_READY_POLL_INTERVAL_MS);
    }
    return this.backendRunning();
  }

  /**
   * The backend answers PENDING while it establishes its first connection, so
   * a single read is not a reliable answer.
   */
  private async requestConnectConfig(): Promise<string> {
    let config: string = '';
    for (let attempt: number = 0; attempt < CONFIG_MAX_ATTEMPTS; attempt++) {
      config = await this.gateway.requestVpnConfig();
      if (!config.includes(CONFIG_PENDING_MARKER)) {
        return config;
      }
      await VpnSessionController.sleep(CONFIG_RETRY_INTERVAL_MS);
    }
    return config;
  }

  private async awaitBackendStop(filesDir: string, requestId: number): Promise<void> {
    for (let attempt: number = 0; attempt < STOP_POLL_MAX_ATTEMPTS; attempt++) {
      const response: string | undefined =
        this.gateway.readCommandFile(filesDir, VPN_STOP_RESPONSE_FILE_NAME);
      if (response !== undefined && response.length > 0 && VpnSessionController.matchesRequest(response, requestId)) {
        this.gateway.writeCommandFile(filesDir, VPN_STOP_RESPONSE_FILE_NAME, '');
        return;
      }
      await VpnSessionController.sleep(STOP_POLL_INTERVAL_MS);
    }
    // Unanswered means the extension is already gone; stopping it is harmless.
  }

  private backendRunning(): boolean {
    try {
      return this.gateway.backendStatus().includes('state=Running');
    } catch (_error) {
      return false;
    }
  }

  private backendNeedsLogin(): boolean {
    try {
      const status: string = this.gateway.backendStatus();
      return status.includes('NeedsLogin') || status.includes('loginURLReady=true');
    } catch (_error) {
      return false;
    }
  }

  private clearHandoffFiles(filesDir: string): void {
    this.gateway.writeCommandFile(filesDir, VPN_BACKEND_HANDOFF_REQUEST_FILE_NAME, '');
    this.gateway.writeCommandFile(filesDir, VPN_BACKEND_HANDOFF_RESPONSE_FILE_NAME, '');
  }

  private static matchesRequest(response: string, requestId: number): boolean {
    try {
      const parsed: Record<string, number> = JSON.parse(response) as Record<string, number>;
      return parsed.requestId === requestId;
    } catch (_error) {
      return false;
    }
  }

  private static osVersion(): string {
    const majorVersion: number = Number(deviceInfo.majorVersion);
    const seniorVersion: number = Number(deviceInfo.seniorVersion);
    if (majorVersion > 0) {
      return `${majorVersion}.${Math.max(0, seniorVersion)}`;
    }
    const fullNameMatch: RegExpMatchArray | null = deviceInfo.osFullName.trim().match(/(\d+)\.(\d+)/);
    return fullNameMatch === null ? deviceInfo.osFullName : `${fullNameMatch[1]}.${fullNameMatch[2]}`;
  }

  private static sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, ms);
    });
  }
}
