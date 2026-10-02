# Optional Toss Shopping affiliate links

The RN `./shopping` entry point supports operator-issued links with an injected
URL opener. It does not enroll an affiliate, generate referral URLs, choose
products, verify purchases, or award points. No TrailBase migration or mTLS
adapter is involved. Keep product selection and placement rules in the consumer.

```ts
import { openURL } from "@granite-js/react-native";
import {
  createAppsInTossShoppingBridge,
  normalizeAppsInTossShoppingLink,
} from "@trailbase-apps-in-toss-kit/ait-rn/shopping";

// Create once, shared by the app's placements.
const shopping = createAppsInTossShoppingBridge({ openURL });
const link = normalizeAppsInTossShoppingLink(operatorConfiguredLink);
// Hide the placement if link is null. On an explicit button press only:
const result = await shopping.open(link);
// failed: show a retry message. busy: ignore the duplicate tap.
// dispatched: only the native URL call resolved, not a verified conversion.
```

Only `https://toss.shopping/...` and `https://toss.im/...` are accepted; credentials,
custom ports, malformed URLs and lookalike hosts are rejected. The issued query
string is preserved, without adding user IDs or guessed affiliate parameters.
Destination validation does not prove that the URL is a shopping link or belongs
to the operator's affiliate account. Obtain and test the real link before enabling
the placement. A common shopping entry link can serve multiple placements without
manually binding products to each item of consumer content.

The consumer should:

- Hide unconfigured placements and leave existing ads/primary actions usable.
- Show a visible commission disclosure next to the link, for example:
  “이 링크를 통해 구매하면 운영자가 수수료를 받을 수 있어요.”
- Use neutral copy such as “토스쇼핑 둘러보기”; do not claim matched products,
  discounts, or rewards unless verified by a separate source.
- Keep selection stable during a screen visit, within existing ad spacing.
- Preserve the source screen and selection on navigation; never clear them on a
  successful open. Test actual Android/iOS return behavior before release.
- Track only placement and outcomes such as `open_dispatched` / `open_failed`.
  Do not log the full URL, native error, user identity, or infer purchases from
  clicks. Purchase attribution belongs to the affiliate provider's reports.

Use the documented [openURL API](https://developers-apps-in-toss.toss.im/documentation/common/screen/open-url.md).
It opens a browser or associated app; it does not guarantee an in-Toss route.
The official community documents [no dedicated shopping navigation SDK](https://techchat-apps-in-toss.toss.im/t/topic/4102)
and an [Android return-navigation issue](https://techchat-apps-in-toss.toss.im/t/toss-im/4625).
Do not invent an `intoss://shopping` route or retry through a different destination.

For RN, inject Granite's opener as above. A Web consumer can inject its supported
opener into the pure helper, but must validate package resolution and Web navigation
separately. This addition does not expand the `ait-web` package contract.

Server-side category/deal selection and Sharelink issuance are available in [affiliate catalog](affiliate-catalog.md).
