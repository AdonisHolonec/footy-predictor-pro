\# Footy Predictor Pro — AI Development Workflow



Version: 1.0



This document defines the standard AI workflow for the Footy Predictor Pro project.



The goal is to ensure consistent, high-quality development while minimizing unnecessary context and avoiding tool misuse.



\---



\# Core Principles



Every task should:



\- preserve PredictorV3 logic unless explicitly requested

\- prefer root-cause fixes over quick patches

\- avoid duplicated logic

\- keep architecture clean

\- keep UI modern (2026–2027)

\- preserve performance

\- avoid unnecessary dependencies



\---



\# Core Tools



\## Claude Mem



Purpose



Persistent project memory.



Use when:



\- continuing previous work

\- maintaining architectural consistency

\- recalling previous design decisions



Do NOT use as a replacement for source code.



\---



\## Graphify



Purpose



Architecture analysis.



Use for:



\- dependency analysis

\- large refactors

\- pipeline tracing

\- dead code detection

\- coupling analysis



Avoid using it for simple UI tweaks.



\---



\## CodeGraph



Purpose



Fast code navigation.



Use for:



\- symbol lookup

\- impact analysis

\- call hierarchy

\- finding implementation points



Prefer before using grep.



\---



\# UI Stack



\## UI/UX Pro Max



Primary UI skill.



Use for:



\- application UI

\- dashboards

\- prediction cards

\- modals

\- admin panel

\- retention

\- conversion

\- information hierarchy



Always preferred for product UI.



\---



\## Impeccable



Use:



\- after UI implementation

\- before commit

\- before merge



Workflow:



Critique



↓



Fix



↓



Verify



Never use Impeccable as the initial design tool.



\---



\## Design Taste Frontend



Purpose



Marketing pages only.



Use for:



\- Landing

\- Pricing

\- About

\- Login

\- Register

\- Upgrade pages

\- Marketing redesign



Do NOT use for:



\- dashboards

\- tables

\- live statistics

\- admin interfaces



\---



\## High-End Visual Design



Use only when:



the goal is visual refinement.



Never use for architecture.



\---



\## Redesign Existing Projects



Use when:



redesigning existing pages without changing business logic.



\---



\## Image to Code



Use when:



\- screenshots

\- Figma

\- Dribbble

\- Behance

\- design inspiration



\---



\# Standard Presets



\## Dashboard Development



Use:



\- Claude Mem

\- Graphify

\- CodeGraph

\- UI/UX Pro Max

\- Impeccable



Never invoke Design Taste Frontend.



\---



\## Landing Development



Use:



\- Claude Mem

\- Graphify

\- CodeGraph

\- UI/UX Pro Max

\- Impeccable

\- Design Taste Frontend

\- High-End Visual Design



\---



\## Architecture Tasks



Use:



\- Claude Mem

\- Graphify

\- CodeGraph



Avoid unnecessary UI skills.



\---



\## Performance



Use:



\- Graphify

\- CodeGraph



Focus on:



\- render performance

\- bundle size

\- cache

\- architecture



\---



\## UX Review



Use:



\- UI/UX Pro Max

\- Impeccable



Goal:



2026–2027 premium SaaS quality.



\---



\# Coding Rules



Always:



\- reuse existing abstractions

\- avoid duplicated logic

\- keep constants centralized

\- preserve type safety

\- preserve tests



Never:



\- hardcode business rules

\- duplicate helper functions

\- create parallel implementations



\---



\# Validation Checklist



Every feature should finish with:



✓ Typecheck



✓ ESLint



✓ Tests



✓ Build



✓ Architecture review



✓ UI review (if applicable)



✓ Bundle impact



\---



\# Commit Checklist



Before committing verify:



\- no duplicated logic

\- no dead code

\- no temporary debug code

\- no console.log

\- no unused imports

\- no unnecessary dependencies



\---



\# Product Principles



Footy Predictor Pro is not a statistics application.



It is a football intelligence platform.



Every feature should answer one of the following:



\- What is happening?

\- Why is it happening?

\- What changed?

\- What should the user pay attention to?



Avoid adding UI that merely displays numbers without interpretation.



