"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}


// ---- Pop-ups grow out of whatever was tapped and shrink back into it on close ----
// The last press is remembered so a dialog mounting right after it knows its source.
let lastPress: { t: number; el: Element | null; x: number; y: number } | null = null
if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      const target = e.target as Element | null
      lastPress = {
        t: performance.now(),
        x: e.clientX,
        y: e.clientY,
        el: target?.closest?.("button,a,[role=button],[role=menuitem],label,.journal-card,.today-task-card,.moment-card") ?? null,
      }
    },
    { capture: true, passive: true }
  )
}
const pointRect = (x: number, y: number) => new DOMRect(x - 24, y - 24, 48, 48)
function flipTransform(src: DOMRect, dst: DOMRect) {
  const sx = Math.max(src.width / dst.width, 0.04)
  const sy = Math.max(src.height / dst.height, 0.04)
  const dx = src.left + src.width / 2 - (dst.left + dst.width / 2)
  const dy = src.top + src.height / 2 - (dst.top + dst.height / 2)
  return `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`
}
const SCROLLERS = ".memory-scroll,.dump-scroll,.editor-scroll,.memory-gallery,.memory-stack,.moments"
function expandFromSource(el: HTMLDivElement | null) {
  if (!el || typeof window === "undefined") return
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  const press = lastPress && performance.now() - lastPress.t < 1500 ? lastPress : null
  const sourceEl = press?.el && press.el.isConnected ? press.el : null
  const liveRect = (node: Element | null) => {
    const r = node?.getBoundingClientRect()
    return r && r.width > 0 && r.height > 0 ? r : null
  }
  const sourceRect = liveRect(sourceEl) ?? (press ? pointRect(press.x, press.y) : null)
  const dst = el.getBoundingClientRect()
  if (!reduce) {
    el.animate(
      [
        { transform: sourceRect ? flipTransform(sourceRect, dst) : "scale(0.94)", opacity: 0 },
        { opacity: 1, offset: 0.55 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 300, easing: "cubic-bezier(0.2, 0.9, 0.25, 1)" }
    )
  }
  return () => {
    if (reduce || !el.isConnected) return
    // React detaches the ref before removing the node, so it can still be measured and copied here.
    const now = el.getBoundingClientRect()
    const scrolls = [el, ...el.querySelectorAll(SCROLLERS)].map((n) => [n.scrollTop, n.scrollLeft])
    const ghost = el.cloneNode(true) as HTMLElement
    ghost.removeAttribute("id")
    ghost.setAttribute("aria-hidden", "true")
    ghost.inert = true
    ghost.style.pointerEvents = "none"
    const veil = document.createElement("div")
    veil.className = "dialog-exit-veil"
    document.body.appendChild(veil)
    document.body.appendChild(ghost)
    ;[ghost, ...ghost.querySelectorAll(SCROLLERS)].forEach((n, i) => {
      const [top, left] = scrolls[i] ?? [0, 0]
      n.scrollTop = top
      n.scrollLeft = left
    })
    const target = liveRect(sourceEl) ?? sourceRect
    const out = ghost.animate(
      [
        { transform: "none", opacity: 1 },
        { opacity: 1, offset: 0.35 },
        { transform: target ? flipTransform(target, now) : "scale(0.94)", opacity: 0 },
      ],
      { duration: 240, easing: "cubic-bezier(0.4, 0, 0.7, 0.2)", fill: "forwards" }
    )
    const fade = veil.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 240, easing: "ease-out", fill: "forwards" })
    const cleanup = () => {
      ghost.remove()
      veil.remove()
    }
    out.finished.catch(() => {}).finally(cleanup)
    fade.finished.catch(() => {}).finally(cleanup)
    // Safety net: if the page is backgrounded mid-animation, don't leave the snapshot behind.
    window.setTimeout(cleanup, 700)
  }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ref,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const animatedRef = React.useCallback(
    (el: HTMLDivElement | null) => {
      if (typeof ref === "function") ref(el)
      else if (ref) ref.current = el
      return expandFromSource(el)
    },
    [ref]
  )
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={animatedRef}
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg outline-none sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
