## ADDED Requirements

### Requirement: Runtime-hosted commands cannot control their own instance
Kun SHALL refuse a Runtime stop or restart command before any shutdown request when agent-controlled execution targets the exact Runtime instance that hosts the command.

#### Scenario: Hosted restart targets the same healthy Runtime
- **WHEN** a Runtime-hosted shell invokes `kun runtime restart` and its instance marker equals the target discovery instance ID
- **THEN** the CLI SHALL return Runtime error exit code 70 with code `runtime_self_control_forbidden`, SHALL NOT send a shutdown request, and the Runtime SHALL remain available

#### Scenario: Hosted stop targets an unhealthy but discoverable same Runtime
- **WHEN** a Runtime-hosted shell invokes `kun runtime stop`, health probing fails, and the target discovery instance ID still equals the hosted instance marker
- **THEN** the CLI SHALL refuse the command using the same stable error without relying on PID or health identity

#### Scenario: Target discovery changes during command handling
- **WHEN** the target changes between the initial check and the final shutdown inspection and the final target equals the hosted instance marker
- **THEN** the CLI SHALL repeat the identity check and refuse before sending the shutdown request

### Requirement: Trusted external Runtime controls retain existing behavior
Kun SHALL continue to allow existing explicit stop and restart flows when the caller has no hosted Runtime instance marker or the marker identifies a different Runtime.

#### Scenario: External terminal restarts the shared Runtime
- **WHEN** an external CLI invocation has no `KUN_RUNTIME_INSTANCE_ID`
- **THEN** the existing explicit restart authorization, process revalidation, shutdown, replacement, and health-check behavior SHALL remain unchanged

#### Scenario: Different Runtime instance controls the target
- **WHEN** the caller's hosted instance marker differs from the target discovery instance ID
- **THEN** the CLI SHALL not classify the request as same-instance self-control

### Requirement: Runtime identity propagation is non-secret and minimal
The agent shell SHALL expose only the Runtime instance identity needed for the self-control check and SHALL continue to exclude lifecycle tokens and model credentials.

#### Scenario: Agent shell environment is constructed
- **WHEN** a built-in shell command is spawned inside a Runtime
- **THEN** `KUN_RUNTIME_INSTANCE_ID` SHALL be available while Manager tokens, Runtime tokens, API keys, and other filtered secrets SHALL remain unavailable
