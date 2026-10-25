import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "80px 24px" }} data-testid="not-found">
      <h1 className="display-heading" style={{ fontSize: 40, margin: "0 0 12px" }}>That page does not exist</h1>
      <p className="text-sm font-light" style={{ color: "var(--color-ash)" }}>
        The address does not match anything here. <Link to="/" style={{ color: "var(--color-crude)", textDecoration: "underline" }}>Back to the map</Link>.
      </p>
    </main>
  );
}
