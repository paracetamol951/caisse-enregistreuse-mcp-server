# Fidélité et cartes cadeaux Kash

Ces outils appellent les routes `/api/partner/v1` de l’établissement associé à la connexion. Ils renvoient les données de Kash dans `structuredContent.data`. Les historiques utilisent un curseur opaque dans `structuredContent.pagination.next_cursor`.

| Outil | Permission | Fonction |
| --- | --- | --- |
| `loyalty_get_program` | `customers.read` | Consulter le programme de l’établissement et les règles de récompense. |
| `loyalty_get_account` | `customers.read` | Consulter le solde et les récompenses disponibles d’un client. |
| `loyalty_list_movements` | `customers.read` | Lire les mouvements de fidélité connus pour ce client. |
| `loyalty_quote` | `customers.read`, `catalog.read` | Simuler les points et les récompenses applicables à un panier. |
| `gift_card_check` | `sales.read` | Consulter l’état, la devise, le solde et la validité d’une carte. Fournir `amount` pour vérifier une utilisation. |
| `gift_card_list_movements` | `sales.read` | Lire les paiements et paiements de retour enregistrés avec cette carte. |

En HTTP OAuth, reliez l’établissement et accordez les permissions requises par l’outil. En STDIO, configurez `SHOPID` et une clé partenaire gérée `KASH_PARTNER_API_KEY` ayant les mêmes permissions. La présence de cette clé active les six outils STDIO. Les droits en caisse de l’acteur associé s’appliquent aussi. Gardez les identifiants dans la configuration privée du serveur MCP.

## Estimer puis utiliser une récompense

Exemple avec des identifiants fictifs. Consultez `loyalty_get_account` avec `customer_id` pour connaître les récompenses déjà acquises. La simulation tient compte du panier et, si renseigné, du compte du client.

```json
{
  "name": "loyalty_quote",
  "arguments": {
    "customer_id": 12,
    "cart": {
      "lines": [{ "item_id": 24, "quantity": 2 }],
      "context": "on_premises"
    }
  }
}
```

Appliquez la récompense éligible dans le parcours de vente en caisse. Après validation, relisez le compte et l’historique connu. Si un retour intervient, rattachez-le à la vente source en caisse et relisez ensuite le compte.

Dans l’historique, `source_order_id` rattache un retour à sa vente quand ce lien est disponible. `points_on_reward_lines` peut valoir `null` sur une installation qui conserve les tickets archivés sans leurs lignes.

## Vérifier un paiement partiel et consulter son retour

Le code de l’exemple est fictif. Dans un appel réel, passez le code exclusivement dans `code` et évitez de le copier dans les messages, liens, captures ou journaux. Le serveur le transmet dans le corps JSON à Kash et l’écarte de la sortie de l’outil.

```json
{
  "name": "gift_card_check",
  "arguments": { "code": "734530142274152831", "amount": "15.00" }
}
```

Pour une carte à usages multiples avec 10,00 EUR utilisables, `check.covered` vaut `false` et `check.applicable_amount` indique la part de 10,00 EUR. Si le parcours en caisse permet le paiement mixte, appliquez cette part et enregistrez les 5,00 EUR restants sur un autre mode de paiement autorisé. Vérifiez `use_mode` et `check.single_use_consumes_balance` pour une carte à usage unique. Un solde `null` indique que Kash ne peut pas déterminer ce montant.

Effectuez la restitution par le retour caisse relié à la vente. Relisez le solde puis recherchez un mouvement `kind: refund_payment` avec l’identifiant de la commande de retour.

```json
{
  "name": "gift_card_list_movements",
  "arguments": { "code": "734530142274152831", "limit": 10 }
}
```

L’historique couvre les paiements liés effectivement conservés, y compris les paiements de retour identifiés. Les écritures disponibles sur les anciennes cartes ne suffisent parfois à reconstituer qu’une partie des débits et restitutions.

## Reprise des appels

Les six outils effectuent des lectures et des simulations. Rejouez un appel en erreur avec les mêmes arguments. Pour continuer un historique, utilisez le `next_cursor` du dernier résultat avec le même établissement et le même client ou code. Une authentification expirée nécessite de reconnecter le compte ou de remplacer la clé partenaire. Un droit manquant, une référence absente dans l’établissement, une demande invalide ou une indisponibilité de Kash sont signalés comme erreurs d’outil. Les confirmations et écritures passent par les parcours de vente et de retour en caisse.
