#!/usr/bin/env bash
# Builds a minimal read-only lowerdir for runbox from the host's binaries.
# Usage: make-rootfs.sh OUTDIR [--python /usr/bin/python3.X] [--gcc] [BINARY...]
#
# Copies each binary plus its shared-library closure (via ldd), the C/C++
# runtime libs, and optionally a Python interpreter with its stdlib.
# --gcc adds the host's gcc/g++ toolchain (driver, cc1/cc1plus, as, ld,
# headers, crt files) so submissions can be compiled inside runbox too.
# In production, build this once per language image (debootstrap, a
# distroless tarball, etc.) and keep it read-only; runbox never writes to it.
set -euo pipefail

out=${1:?usage: make-rootfs.sh OUTDIR [--python PY] [BIN...]}; shift
python=""
gcc=0
bins=()
while [[ $# -gt 0 ]]; do
  case $1 in
    --python) python=$2; shift 2 ;;
    --gcc) gcc=1; shift ;;
    *) bins+=("$1"); shift ;;
  esac
done

mkdir -p "$out"/{bin,usr/bin,usr/lib,lib64,lib/x86_64-linux-gnu,etc,box,tmp,proc,dev}
# one multiarch lib dir, reachable by both names (as on merged-/usr hosts)
[[ -e $out/usr/lib/x86_64-linux-gnu ]] || ln -s ../../lib/x86_64-linux-gnu "$out/usr/lib/x86_64-linux-gnu"
chmod 1777 "$out/tmp"

copy_with_libs() {
  local f=$1 dst=${2:-$1}
  mkdir -p "$out$(dirname "$dst")"
  cp -L "$f" "$out$dst"
  ldd "$f" 2>/dev/null | grep -oE '/[^ ]+' | while read -r lib; do
    [[ -e $lib ]] || continue
    mkdir -p "$out$(dirname "$lib")"
    cp -L --update=none "$lib" "$out$lib" 2>/dev/null || true
  done || true  # static binaries: ldd lists nothing, grep exits 1 under pipefail
}

copy_with_libs /bin/sh
for b in /bin/cat /bin/echo /bin/true; do [[ -e $b ]] && copy_with_libs "$b"; done
for b in "${bins[@]}"; do copy_with_libs "$b"; done

# C++ runtime for compiled submissions.
for lib in libstdc++.so.6 libgcc_s.so.1 libm.so.6; do
  p=$(ldconfig -p | awk -v l="$lib" '$1==l && /x86-64/ {print $NF; exit}')
  [[ -n ${p:-} ]] && { mkdir -p "$out$(dirname "$p")"; cp -L --update=none "$p" "$out$p"; }
done

libs_of() {
  ldd "$1" 2>/dev/null | grep -oE '/[^ ]+' | while read -r lib; do
    if [[ -e $lib && ! -e $out$lib ]]; then mkdir -p "$out$(dirname "$lib")"; cp -L "$lib" "$out$lib"; fi
  done || true  # static binaries: ldd lists nothing, grep exits 1 under pipefail
}

if (( gcc )); then
  for b in gcc g++ cc c++ as ld ld.bfd; do
    p=$(command -v "$b") || continue
    copy_with_libs "$(readlink -f "$p")"
    cp -L "$p" "$out/usr/bin/$b"
  done
  libexec=$(dirname "$(gcc -print-prog-name=cc1)")
  mkdir -p "$out$libexec"
  cp -a "$libexec/." "$out$libexec/"
  for f in "$out$libexec"/*; do if [[ -f $f ]]; then libs_of "$f"; fi; done
  cp -a /usr/lib/gcc "$out/usr/lib/"
  cp -a /usr/include "$out/usr/"
  ml=/usr/lib/x86_64-linux-gnu
  for f in crt1.o crti.o crtn.o Scrt1.o rcrt1.o libc.so libc_nonshared.a libc.a \
           libm.so libm.a libmvec.so libmvec.a libmvec.so.1 libpthread.a libdl.a librt.a \
           libstdc++.so.6 libgcc_s.so.1; do
    if [[ -e $ml/$f ]]; then cp -L "$ml/$f" "$out/lib/x86_64-linux-gnu/"; fi
  done
  echo "gcc $(gcc -dumpversion) installed"
fi

if [[ -n $python ]]; then
  ver=$("$python" -c 'import sys;print(f"{sys.version_info[0]}.{sys.version_info[1]}")')
  copy_with_libs "$python" /usr/bin/python3
  libdir=$("$python" -c 'import sysconfig;print(sysconfig.get_paths()["stdlib"])')
  mkdir -p "$out$libdir"
  # stdlib without tests/site-packages; keeps the image small
  tar -C "$libdir" --exclude=test --exclude=tests --exclude=idlelib \
      --exclude=site-packages --exclude=dist-packages --exclude=__pycache__ \
      --exclude=tkinter --exclude=ensurepip -cf - . | tar -C "$out$libdir" -xf -
  for so in "$out$libdir"/lib-dynload/*.so; do
    # Some extensions are statically linked: ldd prints no paths, grep exits 1,
    # and pipefail would end the script. libs_of tolerates that.
    libs_of "$so"
  done
  echo "python $ver installed at /usr/bin/python3"
fi

cat > "$out/etc/passwd" <<P
root:x:0:0:root:/root:/bin/sh
nobody:x:65534:65534:nobody:/box:/bin/sh
P
cat > "$out/etc/group" <<G
root:x:0:
nogroup:x:65534:
G
echo "127.0.0.1 localhost runbox" > "$out/etc/hosts"

chown -R root:root "$out"
chmod -R a+rX "$out"
echo "rootfs ready: $out ($(du -sh "$out" | cut -f1))"
