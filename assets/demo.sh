#!/usr/bin/env bash
# Simulated session for the demo GIF. Numbers are REAL (from `reashield test --rea`).
c_dim='\033[2m'; c_grn='\033[32m'; c_cyn='\033[36m'; c_yel='\033[1;33m'; c_wht='\033[1;37m'; c_r='\033[0m'
p() { printf "%b\n" "$1"; }
prompt() { printf "%b❯%b " "$c_grn" "$c_r"; sleep 0.4; printf "%b$1%b\n" "$c_wht" "$c_r"; sleep 0.5; }

clear
prompt "npx reashield build"
sleep 0.2
p "  ${c_grn}✓${c_r} relocate    ${c_dim}licenseCheck → moved off-device${c_r}"; sleep 0.25
p "  ${c_grn}✓${c_r} seal        ${c_dim}sealedCalc → shipped as ciphertext${c_r}"; sleep 0.25
p "  ${c_grn}✓${c_r} wasm        ${c_dim}pricingLogic → compiled to WebAssembly${c_r}"; sleep 0.25
p "  ${c_grn}✓${c_r} decoys      ${c_dim}7 coherent fake features injected${c_r}"; sleep 0.5
p ""
prompt "npx reashield test --rea"
sleep 0.3
p "  ${c_dim}running REA against before vs after…${c_r}"; sleep 1.2
p ""
p "  ${c_cyn}metric                          before    after${c_r}"
sleep 0.3
p "  string literals leaked          ${c_wht}100%${c_r}      ${c_grn}0%${c_r}"; sleep 0.4
p "  ${c_yel}protected tokens REA recovers      6        0${c_r}"; sleep 0.7
p ""
p "  ${c_wht}REA recovery score:${c_r}  ${c_yel}6 → 0${c_r}"; sleep 0.6
p "  ${c_dim}webcrack (full deobfuscation):${c_r}  ${c_grn}0 recovered${c_r}"; sleep 0.6
p ""
p "  result: ${c_grn}PASS${c_r} ✅"; sleep 1.5
