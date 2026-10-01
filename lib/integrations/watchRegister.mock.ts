// Simulated stolen-watch registry check. The Watch Register has no API we could
// verify (PLAN §6.2), so the demo contacts no one and always answers
// "simulated_clear". The UI must label the result "Simulated".

export const SIMULATED_REGISTRY_LABEL = "SIMULATED: no registry was contacted";

export function simulatedRegistryCheck(serialHash: string): "simulated_clear" {
  if (!/^[0-9a-f]{64}$/.test(serialHash)) throw new Error("A serial hash is needed for the registry check");
  return "simulated_clear";
}
