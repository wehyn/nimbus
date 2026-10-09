"use client";

import { memo, useEffect, useState } from "react";

function LauncherClockComponent() {
  const [clock, setClock] = useState({ time: "", date: "" });

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setClock({
        time: new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(now),
        date: new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now),
      });
    };
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  return <div className="launcher-clock"><span className="launcher-time">{clock.time || "—"}</span><span className="launcher-date">{clock.date}</span></div>;
}

export const LauncherClock = memo(LauncherClockComponent);
