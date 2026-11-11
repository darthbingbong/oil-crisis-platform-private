import { Component, type ErrorInfo, type ReactNode } from "react";

/** A rendering failure becomes a calm page with a way back, never a blank screen or a stack trace. The detail goes to the console only. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("render failure", error.message, info.componentStack); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main data-testid="error-page" role="alert" style={{ maxWidth: 640, margin: "0 auto", padding: "80px 24px", color: "var(--color-bone)" }}>
        <h1 className="display-heading" style={{ fontSize: 36, margin: "0 0 12px" }}>Something went wrong on our side</h1>
        <p className="text-sm font-light" style={{ color: "var(--color-ash)" }}>
          This page could not be shown. <a href="/" style={{ color: "var(--color-crude)", textDecoration: "underline" }}>Back to the map</a>, or reload the page.
        </p>
      </main>
    );
  }
}
