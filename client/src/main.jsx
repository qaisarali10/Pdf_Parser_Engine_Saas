import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "./router.jsx";
import App from "./App.jsx";
import { AuthProvider } from "./AuthContext.jsx";
import "./theme.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
