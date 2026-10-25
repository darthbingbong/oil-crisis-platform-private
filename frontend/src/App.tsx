import { Route, Routes } from "react-router-dom";
import Dashboard from "./pages/Dashboard";
import NotFound from "./pages/NotFound";
import Results from "./pages/Results";

/** "/" is the map and scenario controls, "/results" the full report for one scenario (the scenario is in the URL). */
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/results" element={<Results />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
