## ADDED Requirements

### Requirement: Development renderer HTTP cache is disabled

The application SHALL disable Chromium HTTP caching before Electron becomes ready and SHALL clear the existing default Session HTTP cache before loading the main window when the main renderer is loaded from a configured Vite development URL.

#### Scenario: Development renderer starts

- **WHEN** `ELECTRON_RENDERER_URL` contains a non-empty development server URL
- **THEN** the main process appends the `disable-http-cache` Chromium command-line switch before creating the main window
- **AND** it clears the default Session HTTP cache before loading the main window

#### Scenario: Packaged renderer starts

- **WHEN** no development renderer URL is configured
- **THEN** the main process does not append the `disable-http-cache` switch
- **AND** it does not clear the default Session HTTP cache for this policy

### Requirement: Development renderer reloads bypass the browser cache

The application SHALL bypass Chromium's browser cache when reloading a Vite-backed development renderer and SHALL preserve ordinary reload behavior for packaged renderers.

#### Scenario: Reload command in development

- **WHEN** the renderer requests the window reload command while a development renderer URL is configured
- **THEN** the main process calls the web contents cache-bypassing reload operation

#### Scenario: Main-window recovery in development

- **WHEN** the main process recovers a failed development renderer load by reloading the window
- **THEN** it calls the web contents cache-bypassing reload operation

#### Scenario: Reload in a packaged application

- **WHEN** the renderer is not backed by a development server
- **THEN** the main process uses the ordinary web contents reload operation

### Requirement: Auxiliary Vite optimizer state is isolated

Every auxiliary development-renderer Vite run MUST use an optimizer cache directory that is separate from the primary development server's default cache directory.

#### Scenario: Smoke-test renderer starts

- **WHEN** the development renderer smoke launcher creates its unique temporary root
- **THEN** it passes a cache directory beneath that root to the auxiliary Vite configuration

#### Scenario: Auxiliary Vite configuration is missing isolation

- **WHEN** the auxiliary Vite configuration is loaded without an explicit isolated cache directory
- **THEN** configuration fails with an actionable error instead of falling back to the repository's default Vite cache
