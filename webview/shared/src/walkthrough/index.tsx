import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import WalkthroughShell from "./WalkthroughShell";

const root = document.getElementById("root");
if (!root) throw new Error("Root element #root not found");
createRoot(root).render(<StrictMode><WalkthroughShell /></StrictMode>);
