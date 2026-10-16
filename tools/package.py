"""Build a deterministic Foundry release from an explicit set of runtime paths."""
from pathlib import Path
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "https://github.com/Defaulter444/cpred-evasion-workflow"
manifest_bytes = (ROOT / "module.json").read_bytes()
metadata = json.loads(manifest_bytes)
assert metadata["id"] == "cpred-evasion-workflow"
assert metadata["url"] == REPOSITORY
assert metadata["manifest"] == f"{REPOSITORY}/releases/latest/download/module.json"
assert metadata["download"] == f"{REPOSITORY}/releases/download/v{metadata['version']}/module.zip"
assert metadata["compatibility"]["minimum"] == "12.331"
assert metadata["compatibility"]["verified"] == "12.331"
assert any(author["name"] == "yioxar" for author in metadata["authors"])
assert "MIT License" in (ROOT / "LICENSE").read_text(encoding="utf-8")

files = [ROOT / name for name in ("module.json", "LICENSE", "README.md", "CHANGELOG.md")]
for directory in ("scripts", "css", "languages"):
    files.extend(path for path in (ROOT / directory).rglob("*") if path.is_file())
assert all(path.is_file() and path.resolve().is_relative_to(ROOT) for path in files)
assert not any(path.suffix.lower() in {".log", ".db", ".zip", ".lock", ".pyc"} for path in files)
entries = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in files}
assert len(entries) == len(files)
for name in metadata["esmodules"] + metadata["styles"] + [lang["path"] for lang in metadata["languages"]]:
    assert name in entries, name
for name, content in entries.items():
    if name.startswith("languages/") and name.endswith(".json"):
        json.loads(content)

output = ROOT / "dist"
output.mkdir(exist_ok=True)
archive = output / "module.zip"
with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for name, content in sorted(entries.items()):
        info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.create_system = 3
        info.external_attr = 0o100644 << 16
        package.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert set(package.namelist()) == set(entries)
    for name, content in entries.items():
        assert package.read(name) == content, name
    assert package.read("module.json") == manifest_bytes
(output / "module.json").write_bytes(manifest_bytes)
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
(output / "SHA256SUMS.txt").write_bytes(f"{digest}  module.zip\n".encode("utf-8"))
print(json.dumps({"version": metadata["version"], "files": len(entries), "bytes": archive.stat().st_size, "sha256": digest}, indent=2))
