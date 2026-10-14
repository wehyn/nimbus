"use client";

import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion, useDragControls } from "framer-motion";
import { GripVertical } from "lucide-react";

type ReorderableAppProps = {
  appId: string;
  appName: string;
  orderedIds: string[];
  surface: "grid" | "dock";
  disabled: boolean;
  onReorder: (sourceId: string, targetId: string) => void;
  children: ReactNode;
};

export function ReorderableApp({ appId, appName, orderedIds, surface, disabled, onReorder, children }: ReorderableAppProps) {
  const dragControls = useDragControls();
  const descriptionId = useId();
  const longPressRef = useRef<{ timeout: number; pointerId: number; x: number; y: number } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => () => {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timeout);
  }, []);

  function cancelLongPress() {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timeout);
    longPressRef.current = null;
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (disabled || event.button !== 0) return;
    if (event.pointerType !== "touch") {
      dragControls.start(event);
      return;
    }

    cancelLongPress();
    const pointerEvent = event.nativeEvent;
    const timeout = window.setTimeout(() => {
      longPressRef.current = null;
      dragControls.start(pointerEvent);
    }, 350);
    longPressRef.current = { timeout, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function trackLongPress(event: ReactPointerEvent<HTMLButtonElement>) {
    const press = longPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelLongPress();
  }

  function moveWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const currentIndex = orderedIds.indexOf(appId);
    const targetId = orderedIds[currentIndex + (event.key === "ArrowUp" ? -1 : 1)];
    if (currentIndex < 0 || !targetId || disabled) return;
    event.preventDefault();
    onReorder(appId, targetId);
    setAnnouncement(`${appName} moved to position ${currentIndex + (event.key === "ArrowUp" ? 0 : 2)} of ${orderedIds.length}.`);
  }

  function finishDrag(_event: MouseEvent | TouchEvent | PointerEvent, info: { point: { x: number; y: number } }) {
    const target = document.elementFromPoint(info.point.x - window.scrollX, info.point.y - window.scrollY);
    const targetId = target?.closest<HTMLElement>("[data-reorder-id]")?.dataset.reorderId;
    if (targetId) {
      if (targetId !== appId) onReorder(appId, targetId);
      return;
    }

    if (target?.closest(".launcher-dock")) {
      const dockTargetId = orderedIds[Math.min(3, orderedIds.length - 1)];
      if (dockTargetId && dockTargetId !== appId) onReorder(appId, dockTargetId);
    } else if (target?.closest(".launcher-grid")) {
      const lastTargetId = orderedIds.at(-1);
      if (lastTargetId && lastTargetId !== appId) onReorder(appId, lastTargetId);
    }
  }

  return <motion.div
    className={`app-reorderable app-reorderable-${surface}`}
    data-reorder-id={appId}
    drag
    dragControls={dragControls}
    dragListener={false}
    dragMomentum={false}
    dragElastic={0.12}
    layout
    whileDrag={{ scale: 1.04, zIndex: 20 }}
    onDragEnd={finishDrag}
  >
    {children}
    <button
      type="button"
      className="app-reorder-handle"
      aria-label="Reorder application"
      aria-describedby={descriptionId}
      aria-keyshortcuts="ArrowUp ArrowDown"
      title="Drag to reorder; press and hold on touch screens"
      disabled={disabled}
      onPointerDown={startDrag}
      onPointerMove={trackLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={moveWithKeyboard}
    ><GripVertical size={15} aria-hidden="true" /></button>
    <span id={descriptionId} className="visually-hidden">{appName}: use the arrow keys to move. Press and hold to drag on touch screens.</span>
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </motion.div>;
}
