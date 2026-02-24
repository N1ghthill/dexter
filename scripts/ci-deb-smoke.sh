#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact_dir="${repo_root}/artifacts/deb-smoke"
mkdir -p "${artifact_dir}"

collect_artifacts() {
  local files=(
    /tmp/dexter-deb-control.txt
    /tmp/dexter-deb-contents.txt
    /tmp/dexter.log
    /tmp/dexter-smoke.stdout.log
  )

  for file in "${files[@]}"; do
    if [[ -f "${file}" ]]; then
      cp "${file}" "${artifact_dir}/$(basename "${file}")"
    fi
  done
}

trap collect_artifacts EXIT

shopt -s nullglob
debs=("${repo_root}"/release/*.deb)
if [[ "${#debs[@]}" -eq 0 ]]; then
  echo "Nenhum arquivo .deb encontrado em ${repo_root}/release."
  exit 1
fi

deb_file="${debs[0]}"
echo "Usando pacote: ${deb_file}"

apt-get update
apt-get install -y xvfb xauth "${deb_file}"

echo "Inspecionando metadados do .deb..."
dpkg-deb -I "${deb_file}" > /tmp/dexter-deb-control.txt
cat /tmp/dexter-deb-control.txt
echo "Inspecionando conteudo do .deb..."
dpkg-deb -c "${deb_file}" > /tmp/dexter-deb-contents.txt
tail -n 60 /tmp/dexter-deb-contents.txt

if ! grep -q 'resources/helpers/linux/dexter-runtime-helper.sh' /tmp/dexter-deb-contents.txt; then
  echo "Helper Linux nao encontrado no pacote .deb."
  exit 1
fi

if [[ ! -f /opt/Dexter/resources/helpers/linux/dexter-runtime-helper.sh ]]; then
  echo "Helper Linux nao foi instalado em /opt/Dexter/resources/helpers/linux/dexter-runtime-helper.sh."
  exit 1
fi

alsa_link_line="$(ldd /opt/Dexter/dexter | grep 'libasound\.so\.2' || true)"
echo "Resolucao ALSA: ${alsa_link_line:-nao encontrada}"
if [[ "${alsa_link_line}" == *"liboss4-salsa"* ]]; then
  echo "Biblioteca ALSA virtual (liboss4-salsa) detectada; o app requer libasound real."
  exit 1
fi

rm -f /tmp/dexter.log /tmp/dexter-smoke.stdout.log

smoke_user="dexter-smoke"
if ! id -u "${smoke_user}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "${smoke_user}"
fi

set +e
timeout 25s runuser -u "${smoke_user}" -- \
  xvfb-run --auto-servernum --server-args="-screen 0 1280x720x24" \
  env DEXTER_LOG_MIRROR_TMP=1 ELECTRON_DISABLE_SANDBOX=1 /opt/Dexter/dexter --no-sandbox > /tmp/dexter-smoke.stdout.log 2>&1
status=$?
set -e

if [[ "${status}" -ne 0 && "${status}" -ne 124 ]]; then
  echo "Execucao de smoke falhou (status=${status})."
  cat /tmp/dexter-smoke.stdout.log
  exit "${status}"
fi

if [[ ! -f /tmp/dexter.log ]]; then
  echo "Arquivo de log espelho /tmp/dexter.log nao foi criado."
  cat /tmp/dexter-smoke.stdout.log
  exit 1
fi

if ! grep -q '"message":"app.bootstrap"' /tmp/dexter.log; then
  echo "Evento app.bootstrap nao encontrado em /tmp/dexter.log."
  tail -n 120 /tmp/dexter.log || true
  cat /tmp/dexter-smoke.stdout.log
  exit 1
fi

echo "Smoke test .deb validado com sucesso."
tail -n 40 /tmp/dexter.log
