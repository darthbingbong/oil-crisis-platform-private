import { Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { PriceProvider } from "./hooks/PriceProvider";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import Results from "./pages/Results";

/** "/" is the map and scenario controls, "/results" the full report for one scenario (the scenario is in the URL). */
export default function App() {
  return (
    <ErrorBoundary>
    <PriceProvider>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/results" element={<Results />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </PriceProvider>
    </ErrorBoundary>
  );
}
