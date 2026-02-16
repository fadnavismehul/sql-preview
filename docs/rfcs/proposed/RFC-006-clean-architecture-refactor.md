# RFC-006: Clean Architecture Refactor

**Status:** Proposed  
**Created:** 2026-02-16  
**Owner:** Core Team  
**Related ADRs:** None

## Goal

Decouple the SQL Preview MCP Server core logic (`SessionManager`, `Daemon`) from specific implementations like `ConsoleLogger`. This will enable:

1.  **Better Testing**: We can inject mock loggers into `SessionManager` tests.
2.  **Platform Agnostic**: The server logic can run in VS Code (using `OutputChannel` logger) or as a standalone process (using `ConsoleLogger`) without code changes.

## Problem Statement

Currently, `SessionManager` and other server components import `logger` directly from `src/server/ConsoleLogger.ts`. This creates a hard dependency on the console-based implementation. If we wanted to run this logic inside the VS Code extension host (embedded mode) and log to the "SQL Preview" output channel, we couldn't easily do so.

## Proposal

1.  **Define `ILogger` Interface**: Create a shared interface in `src/common/types.ts` that defines standard logging methods (`info`, `error`, `warn`, `debug`).
2.  **Refactor `ConsoleLogger`**: Update `src/server/ConsoleLogger.ts` to implement `ILogger`.
3.  **Refactor `Logger`**: Update `src/core/logging/Logger.ts` (the VS Code one) to implement `ILogger`.
4.  **Dependency Injection**: Update `SessionManager`, `QueryExecutor`, etc., to accept an `ILogger` instance in their constructors instead of importing the singleton directly.
5.  **Wire up in `Daemon`**: The `Daemon` class will be responsible for instantiating the concrete `ConsoleLogger` and passing it to the dependencies.

## Detailed Design

### Interface

```typescript
// src/common/types.ts
export interface ILogger {
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
}
```

### Dependency Injection

```typescript
// src/server/SessionManager.ts
export class SessionManager extends EventEmitter {
  constructor(private logger: ILogger) {
    super();
  }
  // ... imports removed
}
```

## Alternatives Considered

- **Global Singleton with Swap**: We could keep the singleton import but add a method to `src/server/ConsoleLogger.ts` to swap the backing implementation. This is less clean than explicit DI.

## Verification

- **Unit Tests**: Update tests to inject a mock logger.
- **Manual Verification**: Verify the standalone server still logs to console.
