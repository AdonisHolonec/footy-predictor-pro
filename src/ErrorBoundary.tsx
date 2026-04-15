import React from "react";

type State = { error?: Error; info?: React.ErrorInfo };

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[UI crash]", error, info);
    this.setState({ info });
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ fontFamily: "system-ui", padding: 16, lineHeight: 1.4 }}>
          <h1>💥 A crăpat UI-ul</h1>
          <p>
            React a prins o eroare la runtime. Mai jos ai detaliile; cel mai
            probabil una dintre componente aruncă o excepție.
          </p>
          <pre
            style={{
              background: "#111",
              color: "#0f0",
              padding: 12,
              borderRadius: 8,
              overflow: "auto",
              maxHeight: 320,
            }}
          >
{String(this.state.error.stack || this.state.error.message || this.state.error)}
          </pre>
          <button onClick={() => this.setState({ error: undefined, info: undefined })}>
            Reîncearcă
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
