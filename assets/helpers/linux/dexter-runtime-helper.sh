#!/usr/bin/env bash
set -euo pipefail

readonly HELPER_NAME="dexter-runtime-helper"

log() {
  printf '%s\n' "$*" >&2
}

die() {
  log "${HELPER_NAME}: $*"
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "comando obrigatorio ausente: $1"
}

install_ollama() {
  require_cmd bash
  require_cmd curl
  # Whitelist fixa: sem shell arbitrario vindo da UI.
  curl -fsSL https://ollama.com/install.sh | sh
}

start_ollama_service() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl start ollama
    return 0
  fi

  if command -v service >/dev/null 2>&1; then
    service ollama start
    return 0
  fi

  die "nenhum gerenciador de servico suportado encontrado (systemctl/service)"
}

stop_ollama_service() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop ollama
    return 0
  fi

  if command -v service >/dev/null 2>&1; then
    service ollama stop
    return 0
  fi

  die "nenhum gerenciador de servico suportado encontrado (systemctl/service)"
}

restart_ollama_service() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl restart ollama
    return 0
  fi

  if command -v service >/dev/null 2>&1; then
    service ollama restart
    return 0
  fi

  die "nenhum gerenciador de servico suportado encontrado (systemctl/service)"
}

uninstall_dexter_remove() {
  require_cmd apt-get
  DEBIAN_FRONTEND=noninteractive apt-get remove -y dexter
}

uninstall_dexter_purge() {
  require_cmd apt-get
  DEBIAN_FRONTEND=noninteractive apt-get purge -y dexter
  DEBIAN_FRONTEND=noninteractive apt-get autoremove -y
}

uninstall_ollama_system() {
  if command -v systemctl >/dev/null 2>&1; then
    systemctl stop ollama 2>/dev/null || true
    systemctl disable ollama 2>/dev/null || true
  fi

  if command -v service >/dev/null 2>&1; then
    service ollama stop 2>/dev/null || true
  fi

  rm -rf /usr/share/ollama /var/lib/ollama /etc/ollama /opt/ollama /usr/bin/ollama /usr/local/bin/ollama

  if id ollama >/dev/null 2>&1; then
    userdel -r ollama 2>/dev/null || true
  fi

  if getent group ollama >/dev/null 2>&1; then
    groupdel ollama 2>/dev/null || true
  fi
}

helper_status() {
  local has_systemctl="false"
  local has_service="false"
  local has_curl="false"

  command -v systemctl >/dev/null 2>&1 && has_systemctl="true"
  command -v service >/dev/null 2>&1 && has_service="true"
  command -v curl >/dev/null 2>&1 && has_curl="true"

  printf '{"helper":"%s","systemctl":%s,"service":%s,"curl":%s}\n' \
    "${HELPER_NAME}" "${has_systemctl}" "${has_service}" "${has_curl}"
}

main() {
  if [[ $# -lt 1 ]]; then
    die "uso: ${HELPER_NAME} <install-ollama|start-ollama-service|stop-ollama-service|restart-ollama-service|uninstall-dexter-remove|uninstall-dexter-purge|uninstall-ollama-system|status>"
  fi

  case "$1" in
    install-ollama)
      install_ollama
      ;;
    start-ollama-service)
      start_ollama_service
      ;;
    stop-ollama-service)
      stop_ollama_service
      ;;
    restart-ollama-service)
      restart_ollama_service
      ;;
    uninstall-dexter-remove)
      uninstall_dexter_remove
      ;;
    uninstall-dexter-purge)
      uninstall_dexter_purge
      ;;
    uninstall-ollama-system)
      uninstall_ollama_system
      ;;
    status)
      helper_status
      ;;
    *)
      die "acao nao suportada: $1"
      ;;
  esac
}

main "$@"
