import { useEffect } from "react";
import { HubPage } from "./HubPage";
import { EpubReader } from "./read/EpubReader";
import { PdfReader } from "./read/PdfReader";
import { usePlaces } from "./read/place";
import { installHover } from "../shell/hover";
import "./read.css";

/**
 * Reading one book.
 *
 * A port of READ_BODY and READ_JS in server.py. A PDF is drawn here rather
 * than handed to the browser: the browser's own viewer is a closed box, and
 * the text in it cannot be selected from outside, so the right-click menu --
 * copy, look it up, split view -- had nothing to work with on exactly the
 * books you most want it on.
 */
export function Read() {
  const f = bookNamed();
  /* Not a frame before the app's own record of where you were is in.
     Both readers take their place from storage the moment they mount, and a
     book that opens at the top and then jumps is worse than one that opens a
     beat later in the right place. It is a small file over a loopback socket
     -- see place.ts for what is being waited for and why it exists. */
  const ready = usePlaces();

  // A book is on paper. There is nothing to choose.
  useEffect(() => {
    document.body.classList.add("paper");
    installHover(document, window);
    return () => document.body.classList.remove("paper");
  }, []);

  return (
    <HubPage name="books">
      {!f ? (
        <p className="note" id="rd-msg">
          No book named.
        </p>
      ) : !ready ? null : /\.pdf$/i.test(f) ? (
        <PdfReader f={f} />
      ) : (
        <EpubReader f={f} />
      )}
    </HubPage>
  );
}

function bookNamed() {
  try {
    return new URLSearchParams(window.location.search).get("f") || "";
  } catch {
    return "";
  }
}

export default Read;
