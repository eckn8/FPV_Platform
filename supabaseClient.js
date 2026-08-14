// =======================================================
// 🔌 supabaseClient.js — Connexion à Supabase (Auth uniquement)
//
// Nécessite la librairie officielle chargée AVANT ce fichier :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabaseClient.js"></script>
//
// Supabase ne gère ICI que l'authentification (email/mot de
// passe) et la table `profiles` (pseudo public). Aucun modèle,
// image ou fichier STL ne transite par Supabase — ces données
// restent en localStorage pour l'instant et migreront plus tard
// vers un stockage dédié (voir supabase_setup.sql pour le détail
// du schéma, volontairement limité à l'identité).
//
// ⚠️ SUPABASE_PUBLISHABLE_KEY est une clé "publishable" : elle
// est FAITE pour être publique dans du code frontend (comme une
// clé Stripe "publishable"). La sécurité réelle vient des règles
// RLS définies côté serveur, pas du secret de cette valeur.
// Ne jamais mettre ici une clé "secret" / "service_role" — celle-là
// donne un accès total à la base et ne doit exister que côté
// serveur, jamais dans du code qui tourne dans le navigateur.
// =======================================================

const SUPABASE_URL = "https://coyfyedaokkkhtmlcvaq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DeZEOG8W7hbVJ6KBu463QA_9w0bn-nR";

// La librairie expose son propre espace de noms global `supabase`
// (qui contient createClient) — on nomme notre instance autrement
// pour ne pas l'écraser.
const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
