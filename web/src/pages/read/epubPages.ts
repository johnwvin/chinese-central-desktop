/** Lay out one EPUB spine item as separate, viewport-sized reading sheets. */
export async function paginateEpub(host: HTMLElement, html: string, label?: string): Promise<HTMLElement[]> {
  const source = document.createElement("div");
  source.className = "rd-epub-measure";
  source.innerHTML = html;
  if (label) {
    const heading = document.createElement("div");
    heading.className = "rdchap";
    heading.textContent = label;
    source.insertBefore(heading, source.firstChild);
  }
  host.appendChild(source);

  await Promise.all(Array.from(source.querySelectorAll("img"), (image) =>
    image.decode().catch(() => undefined),
  ));

  const pages: HTMLElement[] = [];
  const newPage = () => {
    const sheet = document.createElement("article");
    sheet.className = "rd-epub-sheet";
    host.insertBefore(sheet, source);
    pages.push(sheet);
    return sheet;
  };
  let sheet = newPage();
  while (source.firstChild) {
    const node = source.firstChild;
    if (node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()) {
      source.removeChild(node);
      continue;
    }
    sheet.appendChild(node);
    if (sheet.scrollHeight <= sheet.clientHeight + 1) continue;
    sheet.removeChild(node);
    if (sheet.children.length) {
      sheet = newPage();
      sheet.appendChild(node);
      if (sheet.scrollHeight <= sheet.clientHeight + 1) continue;
      sheet.removeChild(node);
    }
    // Some publishers wrap a whole chapter or illustration list in one div.
    // Split that wrapper at its children before allowing an extra-tall page.
    if (node instanceof HTMLElement && node.matches("div, section, article")) {
      const children = Array.from(node.childNodes).filter((child) =>
        child.nodeType !== Node.TEXT_NODE || !!child.textContent?.trim(),
      );
      if (children.length > 1) {
        const parts = children.map((child) => {
          const part = node.cloneNode(false) as HTMLElement;
          part.appendChild(child);
          return part;
        });
        source.prepend(...parts);
        continue;
      }
    }
    // A single picture or paragraph too tall for the viewport remains whole.
    sheet.appendChild(node);
    sheet.classList.add("rd-epub-oversize");
    if (source.firstChild) sheet = newPage();
  }
  source.remove();
  if (pages.length > 1 && !pages[pages.length - 1].textContent?.trim() && !pages[pages.length - 1].querySelector("img")) {
    pages.pop()?.remove();
  }
  return pages;
}
