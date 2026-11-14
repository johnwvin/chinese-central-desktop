import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkRename } from "../../ui/BookmarkRename";

export function ReaderBookmark({ name, position, onJump, onDelete, onRename }: {
  name: string;
  position: string;
  onJump: () => void;
  onDelete: () => void;
  onRename: (name: string) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const jump = useRef<HTMLButtonElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const title = name || position;

  function showMenu(x: number, y: number) {
    setMenu({
      x: Math.max(4, Math.min(x, window.innerWidth - 124)),
      y: Math.max(4, Math.min(y, window.innerHeight - 48)),
    });
  }

  useEffect(() => {
    if (!menu) return;
    action.current?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (event.target !== action.current) setMenu(null);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
      jump.current?.focus({ preventScroll: true });
    };
    const dismiss = () => setMenu(null);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [menu]);

  return (
    <div className="rd-bookmark" onContextMenu={(event) => {
      event.preventDefault();
      event.stopPropagation();
      showMenu(event.clientX, event.clientY);
    }}>
      <button ref={jump} type="button" className="rd-bookmark-jump" title={title} onClick={onJump}
        onKeyDown={(event) => {
          if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          showMenu(rect.left, rect.bottom);
        }}>
        <b>{title}</b>
        {name && <span>{position}</span>}
      </button>
      <button type="button" className="rd-bookmark-delete" aria-label={`Delete ${title}`}
        title="Delete bookmark" onClick={onDelete}>&times;</button>
      {menu && createPortal(
        <div className="rd-bookmark-menu" role="menu" aria-label="Bookmark actions" style={{ left: menu.x, top: menu.y }}>
          <button ref={action} type="button" role="menuitem" onClick={() => {
            jump.current?.focus({ preventScroll: true });
            setMenu(null);
            setRenaming(true);
          }}>Rename</button>
        </div>,
        document.body,
      )}
      {renaming && <BookmarkRename name={title} onClose={() => setRenaming(false)} onSave={(value) => {
        onRename(value);
        setRenaming(false);
      }} />}
    </div>
  );
}
