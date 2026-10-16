"use client";

import { useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { motion, useDragControls } from "framer-motion";

type ReorderableAppProps = {
  appId: string;
  appName: string;
  orderedIds: string[];
  surface: "grid" | "dock";
  disabled: boolean;
  onReorder: (sourceId: string, targetId: string) => Promise<boolean>;
  onAnnounce?: (message: string) => void;
  onFocusOut?: (appId: string) => void;
  children: ReactNode;
};

export function ReorderableApp({ appId, appName, orderedIds, surface, disabled, onReorder, onAnnounce, onFocusOut, children }: ReorderableAppProps) {
  const dragControls = useDragControls();
  const descriptionId = useId();
  const reorderableRef = useRef<HTMLDivElement>(null);
  const sourceBoundsRef = useRef<DOMRect | null>(null);
  const didDragRef = useRef(false);
  const longPressRef = useRef<{ timeout: number; pointerId: number; x: number; y: number } | null>(null);
  const touchPointerIdRef = useRef<number | null>(null);
  const touchDragArmedRef = useRef(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const element = reorderableRef.current;
    const preventTouchScrollDuringDrag = (event: TouchEvent) => {
      if (touchDragArmedRef.current) event.preventDefault();
    };
    element?.addEventListener("touchmove", preventTouchScrollDuringDrag, { passive: false });
    return () => {
      element?.removeEventListener("touchmove", preventTouchScrollDuringDrag);
      if (longPressRef.current) window.clearTimeout(longPressRef.current.timeout);
    };
  }, []);

  function cancelLongPress() {
    if (longPressRef.current) window.clearTimeout(longPressRef.current.timeout);
    longPressRef.current = null;
  }

  function startDrag(event: ReactPointerEvent<HTMLDivElement>) {
    didDragRef.current = false;
    if (event.pointerType === "touch") {
      if (!(event.target instanceof Element && event.target.closest(".launcher-iconwrap, .dock-icon"))) return;
      touchPointerIdRef.current = event.pointerId;
      touchDragArmedRef.current = false;
    } else {
      touchPointerIdRef.current = null;
      touchDragArmedRef.current = false;
    }
    if (disabled || event.button !== 0) return;
    sourceBoundsRef.current = reorderableRef.current?.getBoundingClientRect() ?? null;
    if (event.pointerType !== "touch") {
      dragControls.start(event);
      return;
    }

    cancelLongPress();
    const pointerEvent = event.nativeEvent;
    const timeout = window.setTimeout(() => {
      longPressRef.current = null;
      touchDragArmedRef.current = true;
      dragControls.start(pointerEvent);
    }, 350);
    longPressRef.current = { timeout, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  }

  function endPointer(event: ReactPointerEvent<HTMLDivElement>) {
    cancelLongPress();
    if (touchPointerIdRef.current === event.pointerId) {
      touchPointerIdRef.current = null;
      touchDragArmedRef.current = false;
    }
  }

  function suppressTouchContextMenu(event: ReactMouseEvent<HTMLDivElement>) {
    if (touchPointerIdRef.current !== null) event.preventDefault();
  }

  function trackLongPress(event: ReactPointerEvent<HTMLDivElement>) {
    const press = longPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8) cancelLongPress();
  }

  async function moveWithKeyboard(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const currentIndex = orderedIds.indexOf(appId);
    const targetId = orderedIds[currentIndex + (event.key === "ArrowUp" ? -1 : 1)];
    if (currentIndex < 0 || !targetId || disabled) return;
    event.preventDefault();
    const nextPosition = currentIndex + (event.key === "ArrowUp" ? 0 : 2);
    const leavesDock = surface === "dock" && event.key === "ArrowDown" && currentIndex === 3;
    const message = `${appName} moved to position ${nextPosition} of ${orderedIds.length}.`;
    if (!await onReorder(appId, targetId)) return;
    if (surface === "dock") onAnnounce?.(message);
    else setAnnouncement(message);
    if (leavesDock) onFocusOut?.(appId);
  }

  async function reorderFromDrag(targetId: string) {
    if (targetId === appId || !await onReorder(appId, targetId)) return;
    if (surface === "dock" && orderedIds.indexOf(appId) < 4 && orderedIds.indexOf(targetId) >= 4) onFocusOut?.(appId);
  }

  async function finishDrag(_event: MouseEvent | TouchEvent | PointerEvent, info: { point: { x: number; y: number } }) {
    window.setTimeout(() => { didDragRef.current = false; }, 0);
    const draggedElement = reorderableRef.current;
    const x = info.point.x - window.scrollX;
    const y = info.point.y - window.scrollY;
    const sourceBounds = sourceBoundsRef.current;
    sourceBoundsRef.current = null;
    if (sourceBounds && x >= sourceBounds.left && x <= sourceBounds.right && y >= sourceBounds.top && y <= sourceBounds.bottom) return;

    const hitStack = document.elementsFromPoint(x, y).filter((element) => !draggedElement?.contains(element));
    const dropSurface = hitStack.map((element) => element.closest(".launcher-dock, .launcher-grid")).find(Boolean);
    const target = hitStack.find((element) => {
      const targetElement = element.closest<HTMLElement>("[data-reorder-id]");
      return targetElement !== null && targetElement !== draggedElement;
    });
    const targetId = target?.closest<HTMLElement>("[data-reorder-id]")?.dataset.reorderId;
    if (targetId) {
      await reorderFromDrag(targetId);
      return;
    }

    if (dropSurface?.matches(".launcher-dock")) {
      const dockTargetId = orderedIds[Math.min(3, orderedIds.length - 1)];
      if (dockTargetId) await reorderFromDrag(dockTargetId);
    } else if (dropSurface?.matches(".launcher-grid")) {
      const lastTargetId = orderedIds.at(-1);
      if (lastTargetId) await reorderFromDrag(lastTargetId);
    }
  }

  function cancelClickAfterDrag(event: ReactMouseEvent<HTMLDivElement>) {
    if (!didDragRef.current) return;
    didDragRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  }

  return <motion.div
    ref={reorderableRef}
    className={`app-reorderable app-reorderable-${surface}`}
    data-reorder-id={appId}
    drag
    dragControls={dragControls}
    dragListener={false}
    onPointerDown={startDrag}
    onPointerMove={trackLongPress}
    onPointerUp={endPointer}
    onPointerCancel={endPointer}
    onContextMenu={suppressTouchContextMenu}
    dragMomentum={false}
    dragSnapToOrigin
    dragElastic={0.12}
    layout
    whileDrag={{ scale: 1.04, zIndex: 20 }}
    onDragStart={() => { didDragRef.current = true; }}
    onClickCapture={cancelClickAfterDrag}
    onDragEnd={finishDrag}
  >
    {children}
    <button
      type="button"
      className="app-reorder-handle visually-hidden"
      aria-label={`Reorder application ${appName}`}
      aria-describedby={descriptionId}
      aria-keyshortcuts="ArrowUp ArrowDown"
      aria-disabled={disabled}
      onKeyDown={moveWithKeyboard}
    />
    <span id={descriptionId} className="visually-hidden">{appName}: use the arrow keys to move. Press and hold to drag on touch screens.</span>
    <span className="visually-hidden" role="status" aria-live="polite">{announcement}</span>
  </motion.div>;
}
