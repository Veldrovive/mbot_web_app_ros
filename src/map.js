/*******************
 * MAP HELPERS
 *******************/

function mapDataToString(data) {
  // Header: origin x, origin y, width, height, meters per cell.
  const header = [...data.origin, data.width, data.height, data.metersPerCell];
  const lines = [header.join(" ")];

  // Cell data, one row per line. Array.prototype.join works on plain and typed arrays.
  for (let i = 0; i < data.height; i++) {
    const row = data.cells.slice(data.width * i, data.width * (i + 1));
    lines.push(Array.prototype.join.call(row, " "));
  }
  return lines.join("\n") + "\n";
}

function downloadMapFile(mapData) {
  const blob = new Blob([mapDataToString(mapData)], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = "current.map";
  document.body.appendChild(anchor);  // Required for Firefox.
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export { downloadMapFile };
