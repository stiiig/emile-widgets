// src/lib/emile/validators.ts

export const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

export function validateEmail(email: string): string | null {
  if (!email.trim()) return "L'email est requis.";
  if (!EMAIL_REGEX.test(email.trim())) return "L'adresse email n'est pas valide.";
  return null;
}

/**
 * Valide un numéro de téléphone.
 * @param tel      La valeur saisie
 * @param required Si false, un champ vide est accepté
 * @param min      Nombre minimum de chiffres (défaut : 6)
 */
export function validatePhone(
  tel: string,
  required = false,
  min = 6,
): string | null {
  if (!tel.trim()) {
    return required ? "Le téléphone est requis." : null;
  }
  if (/[^0-9 \-]/.test(tel)) return "Le téléphone ne peut contenir que des chiffres, espaces et tirets.";
  const digits = tel.replace(/\D/g, "").length;
  if (digits < min) return `Le téléphone doit contenir au moins ${min} chiffres.`;
  return null;
}
