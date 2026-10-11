export const KUN_ACCOUNT_ISSUER = 'https://api-kun-server.com'
export const KUN_ACCOUNT_SUPABASE = 'https://eiiyqwzvuadyzzykxjrc.supabase.co'
// Registered Public client; the desktop app never contains a client secret.
export const KUN_ACCOUNT_CLIENT_ID = '6cbf2d5f-86df-44b2-9161-314081364707'
export const KUN_ACCOUNT_CALLBACK_PORT = 43187
export const KUN_ACCOUNT_CALLBACK_PATH = '/auth/callback'
export const KUN_ACCOUNT_REDIRECT = `http://127.0.0.1:${KUN_ACCOUNT_CALLBACK_PORT}${KUN_ACCOUNT_CALLBACK_PATH}`
// The result page's "Back to Kun" button. It carries no data; the app only reveals its window.
export const KUN_ACCOUNT_RETURN_LINK = 'kun://account'
export const isKunAccountReturnLink = (raw: string): boolean => /^kun:\/\/account\/?$/i.test(raw.trim())
