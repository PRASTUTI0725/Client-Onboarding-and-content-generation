import { createRoot } from "react-dom/client";
import { setDefaultHeaders } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Before any /api request (e.g. react-query on first paint) — do not rely only on the dev proxy.
const localApiKey = import.meta.env.VITE_LOCAL_API_KEY;
if (typeof localApiKey === "string" && localApiKey.length > 0) {
  setDefaultHeaders({ "x-api-key": localApiKey });
}

createRoot(document.getElementById("root")!).render(<App />);
