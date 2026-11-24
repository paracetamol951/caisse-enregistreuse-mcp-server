# Coupons et bons de réduction personnels Kash

Les outils appellent l’API partenaire `/api/partner/v1` pour l’établissement de la connexion. Les résultats figurent dans `structuredContent.data`.

| Outil | Type | Permission | Fonction |
| --- | --- | --- | --- |
| `coupon_check` | Lecture ou simulation | `catalog.read`, `customers.read` | Vérifier un code promotionnel et estimer le montant applicable à un panier. |
| `coupon_issue` | Écriture | `catalog.write` | Créer un code promotionnel rattaché à une remise catalogue existante, avec les droits d’un administrateur ou responsable actif. |
| `personal_voucher_list` | Lecture | `customers.read` | Consulter les bons d’un client, avec leur état et leur commande associée le cas échéant. |
| `personal_voucher_quote` | Simulation | `customers.read`, `catalog.read` | Estimer les bons éligibles et la remise pour le panier d’un client. |
| `personal_voucher_issue` | Écriture | `customers.write` | Émettre un bon pour un client, avec les droits d’un administrateur ou responsable actif de l’établissement. |

En HTTP OAuth, reliez l’établissement et accordez les permissions nécessaires dans Web Services → Applications connectées. En STDIO, configurez `SHOPID` et `KASH_PARTNER_API_KEY` avec une clé partenaire gérée de l’établissement. Les droits de l’acteur associé s’appliquent dans les deux transports.

## Vérifier un code promotionnel

Les exemples utilisent des codes et identifiants fictifs. Mettez le code réel uniquement dans `code`. Kash le reçoit dans le corps JSON, et l’outil renvoie l’identifiant interne, les montants estimés et l’état d’éligibilité.

```json
{
  "name": "coupon_check",
  "arguments": {
    "code": "EXEMPLE2026",
    "customer_id": 12,
    "cashbox_id": 3,
    "cart": { "lines": [{ "item_id": 24, "quantity": 2 }] }
  }
}
```

L’état `context_required` peut demander le client, la caisse ou le panier. Le motif `unsupported_customer_group_rule` renvoie à une règle historique de groupe qui nécessite le parcours de caisse. L’état `ineligible` indique que les conditions actuelles du coupon ne sont pas remplies. Une estimation s’exprime dans la devise de l’établissement. L’application et le comptage des usages se font à la validation de la vente en caisse.

`customer_id` et `cashbox_id` acceptent les identifiants décimaux sous forme de chaînes. Utilisez `-9` pour la boutique en ligne. Dans `cart`, les identifiants d’article et de variante restent des entiers JSON.

Pour créer un coupon, cherchez d’abord une remise catalogue en montant ou en pourcentage avec `data_list_discounts`, puis transmettez son identifiant dans `reduction_id`. Le nouveau code accepte 1 à 50 lettres ASCII, chiffres, tirets ou caractères `_`. La vérification accepte aussi les anciens codes composés de caractères visibles. Exemple de demande explicite de création.

```json
{
  "name": "coupon_issue",
  "arguments": {
    "confirm": true,
    "idempotency_key": "e4ac2aa0-0cce-42cf-a0df-49711445687f",
    "code": "EXEMPLE2026",
    "name": "Offre exemple",
    "reduction_id": 14,
    "max_uses": 50,
    "valid_until": "2026-12-31"
  }
}
```

## Émettre et estimer un bon personnel

Le bon est rattaché au client et se retrouve avec son identifiant Kash. Exemple de demande explicite pour émettre un bon de 10,00 dans la devise de l’établissement, utilisable à partir de 30,00.

```json
{
  "name": "personal_voucher_issue",
  "arguments": {
    "confirm": true,
    "idempotency_key": "7426da72-a386-4a0f-81d9-348e407c3697",
    "customer_id": 12,
    "kind": "fixed",
    "value": "10.00",
    "minimum": "30.00",
    "label": "Geste commercial exemple"
  }
}
```

Utilisez `personal_voucher_quote` avec `customer_id` et `cart` pour simuler les options. Fournissez `voucher_id` si le parcours permet un choix manuel et que vous souhaitez simuler ce bon. Le résultat indique le mode, la remise, le total et le bon sélectionné, le cas échéant. Après validation en caisse, consultez `personal_voucher_list` pour lire l’état du bon et son éventuelle commande. Si d’autres résultats sont disponibles, repassez le `pagination.next_cursor` avec le même `customer_id`.

## Reprendre une émission

Les deux outils d’écriture demandent `confirm: true` et `idempotency_key`. Utilisez une clé unique par émission et transmettez la même clé, les mêmes arguments et le même acteur lors d’une reprise. Une différence de paramètres ou un conflit métier est signalé comme une erreur. Un bon relu après une reprise peut avoir évolué depuis l’émission initiale. La vente et l’utilisation des remises suivent le parcours de caisse.

Une permission ou un rôle insuffisant bloque l’appel. Une référence inconnue dans l’établissement entraîne une erreur de recherche. Un bon choisi qui est indisponible pour le client ou une demande d’émission incompatible avec une opération précédente entraîne une erreur de conflit. L’émission d’un coupon exige un stockage transactionnel. Si ce stockage est indisponible, Kash signale une indisponibilité de l’émission.
