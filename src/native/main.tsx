import React from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { getRouter } from "../router";
import "../styles.css";
import { installNativeSensorAdapters } from "../lib/sw/native-sensors";
import { installNativeMusicLibraryAdapter } from "../lib/sw/native-music-library";

const root = document.getElementById("root");
if (!root) throw new Error("SoundWorld AR: root element not found");

// The native shell shares the same pages, state, and honest unavailable adapters.
// Register real native adapters before enabling a LIVE session in a later phase.
installNativeSensorAdapters();
installNativeMusicLibraryAdapter();
createRoot(root).render(
  <React.StrictMode>
    <RouterProvider router={getRouter()} />
  </React.StrictMode>,
);
