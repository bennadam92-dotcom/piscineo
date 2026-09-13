# Piscineo — devis & factures pour piscinistes

Micro-SaaS de **devis et factures** ciblé **piscinistes / jardiniers indépendants**. Site + application 100 % statiques (HTML/CSS/JS vanilla), déployables sur Render/GitHub Pages, sans build.

## Pourquoi cette niche

Choisi pour un modèle **Google Ads → abonnement honnête** :
- **Besoin mensuel réel** : un pisciniste facture chaque chantier + l'entretien récurrent → vraie rétention (pas de « piège » à la résiliation).
- **Willingness to pay prouvée** : les artisans paient déjà 25-40 €/mois pour ce type d'outil.
- **Intention de recherche forte** : « logiciel devis pisciniste », « faire un devis jardinage »… → parfait pour du paid search.
- **Niche mal servie** par les gros logiciels BTP (orientés maçonnerie), ce qui laisse de la place à un outil qui parle le langage du métier.

## Structure

```
piscineo/
├── index.html            # Landing (SEO/Ads, ciblée piscinistes)
├── app.html              # Application (SPA vanilla, routage par hash)
├── mentions-legales.html
├── confidentialite.html
├── assets/
│   ├── css/style.css
│   └── js/app.js         # Toute la logique de l'app
├── robots.txt · sitemap.xml
```

## L'application (v1)

- **Clients** : carnet d'adresses.
- **Devis** : lignes avec prestations pisciniste pré-remplies (tonte, taille, plantation, engazonnement…), quantités, TVA (ou franchise auto-entrepreneur), remise, calcul auto HT/TVA/TTC.
- **Factures** : création directe ou **conversion d'un devis en 1 clic**, numérotation séquentielle, statuts de paiement.
- **PDF** : document A4 pro (logo + coordonnées + mentions), export via l'impression navigateur (« Enregistrer en PDF »).
- **Tableau de bord** : CA encaissé du mois, en attente, derniers documents.
- **Freemium** : gratuit limité à 3 documents + mention « Réalisé avec Piscineo » ; **Pro 29 €/mois** = illimité, logo, sans mention.

### Limite assumée de la v1

Les données sont stockées **dans le navigateur** (`localStorage`) : par appareil, non synchronisées, non sauvegardées côté serveur. Le paywall Pro est **côté client** (démo). C'est un MVP pour valider la demande et lancer les premières campagnes.

## Phase 2 (pour en faire un vrai produit payant)

1. **Backend + base de données** (Render + Postgres — déjà dispo sur le compte) pour comptes utilisateurs et synchro cloud.
2. **Authentification** (lien magique par email).
3. **Stripe** (mode test d'abord) pour l'abonnement réel — remplacer le déblocage Pro « démo ».
4. **Facturation électronique** : anticiper la réforme française (format Factur-X / e-invoicing).

## Développement local

Aucune dépendance. Ouvrez `index.html`, ou servez le dossier :

```bash
npx serve .
```

## Déploiement

Site statique → Render (Static Site) / Netlify / Cloudflare Pages. Publish directory : `.`
