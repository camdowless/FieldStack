import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initErrorReporter } from "./lib/errorReporter";
import { auth } from "./lib/firebase";

// Initialize error reporter before mounting the app so unhandled errors
// during startup are captured. Uses /api/report-error (Firebase Hosting rewrite
// → reportFrontendError Cloud Function). getUid reads auth.currentUser directly
// so it always reflects the current session without needing the React context.
initErrorReporter({
  endpoint: "/api/report-error",
  getUid: () => auth.currentUser?.uid ?? null,
});

createRoot(document.getElementById("root")!).render(<App />);
