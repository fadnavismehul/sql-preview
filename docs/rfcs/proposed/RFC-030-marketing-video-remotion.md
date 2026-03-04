# RFC-030: Marketing Video using Remotion

**Status:** Proposed  
**Created:** 2026-03-05  
**Owner:** Marketing / Core Team  

## Goal

Create high-quality, reproducible marketing videos for SQL Preview using [Remotion](https://www.remotion.dev/). This allows us to automate video production, ensure UI consistency, and easily update videos as the product evolves.

## Problem Statement

Manual video editing (e.g., using Screenflow, Loom, or Premiere) is time-consuming and difficult to maintain. Every time the UI changes (e.g., a new theme, a button move, or a brand refresh), the entire marketing video needs to be re-recorded and re-edited. This creates a bottleneck for marketing and leads to outdated assets.

## Scope

- **In Scope:**
    - Setting up a Remotion project within the repository or as a sub-package.
    - Creating reusable React-based video components for SQL Preview.
    - Automating video rendering via CLI/GitHub Actions.
    - Scenes for: Claude Desktop integration, VS Code extension, Multi-connector support (Postgres, BigQuery, Snowflake).
- **Out of Scope:**
    - Live-action recording.
    - Voiceover generation (though it can be integrated later).

## Proposal

We propose using Remotion to build our marketing videos as code. 

1. **Architecture**: Create `packages/marketing-video` using Remotion.
2. **Component Reuse**: Leverage existing UI components or create high-fidelity mocks that mimic the `project-preview` aesthetics (Inter font, sleek gradients, glassmorphism).
3. **Data Driven**: Use JSON/TypeScript files to define the "storyboard" and query examples shown in the video.
4. **Rendering**: Use Remotion's AWS Lambda or GitHub Actions integration for fast, automated rendering.

## Alternatives Considered

- **Manual Recording**: High effort, low maintainability.
- **Loom/Descript**: Good for quick demos, but lacks the "premium" feel and programmatic control needed for brand-level marketing.

## Implementation Plan

1.  **Phase 1: Setup**
    - `npx create-remotion@latest packages/marketing-video`
    - Configure tailwind/css to match main app styling.
2.  **Phase 2: Core Components**
    - Build `WindowFrame`, `Terminal`, `SqlEditor`, and `DataGrid` Remotion components.
3.  **Phase 3: Scene Design**
    - Scene 1: "Wait, isn't that just SQL?" (Claude Desktop demo)
    - Scene 2: "Deep Dive in VS Code" (AG Grid demo)
    - Scene 3: "One Tool, All Databases" (Connectors montage)
4.  **Phase 4: Automation**
    - CI/CD pipeline to render `latest.mp4` on every release.

## Acceptance Criteria

- [ ] Remotion project compiles and previews locally.
- [ ] Rendered video matches the premium aesthetics of the app.
- [ ] A 60-second summary video is generated automatically.

## Risks and Mitigations

- **Complexity**: Remotion has a learning curve. *Mitigation*: Start with simple components and build up.
- **Rendering Cost**: Local rendering can be slow. *Mitigation*: Use a dedicated CI worker or AWS Lambda.

## Rollout and Backout

- **Rollout**: Add to `docs/` and link in `README.md`.
- **Backout**: Delete the `packages/marketing-video` directory if it becomes a maintenance burden.

## Open Questions

- Should we use AI voiceovers (e.g., ElevenLabs) integrated into the script?
- Do we want to capture real app screenshots or mock everything in React for 100% control?
