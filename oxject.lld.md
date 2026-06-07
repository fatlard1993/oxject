# Oxject

> src/Oxject.js · src/derive.js

Reactive state container built on the platform's own EventTarget. Property access and assignment look like a plain object; the reactivity is invisible. Callers write `state.count++` and anything subscribed to `count` updates automatically, with no special setter syntax, no `.value` unwrapping, and no compile step.

The constructor returns a Proxy rather than the instance itself, making invisible assignment interception possible without changing the call site. `instanceof Oxject` returns false as a consequence.

## The container only accepts a plain object

- constructing with anything other than a plain object is an error; null, arrays, strings, and primitives are all rejected immediately
  - does constructing with null throw?
  - does constructing with an array throw?
  - does constructing with a plain object succeed?

## Property changes are immediate and synchronous

- assigning to a property notifies all subscribers before the assignment expression returns; there is no async tick and no deferred flush
  - does a subscriber fire before the next line of code executes?

## Subscriptions are key-scoped

- a subscription fires only when its registered key changes; changes to other properties do not trigger it
  - does a subscriber for one key not fire when a different key changes?

## Subscribers receive the new value directly

- the callback receives the value just assigned; it does not need to re-read from the state object
  - does the subscriber receive the new value as its argument?

## Assigning the same value does nothing

- if the incoming value is equal to the stored value, no subscribers are notified and no events are dispatched
  - does assigning the same value as the current one not call subscribers?

## The platform's event system is the notification infrastructure

- the instance is itself an EventTarget; property changes dispatch events natively; addEventListener is a valid alternative to subscribe(), and AbortSignal and `{ once }` work without any additional support
  - does addEventListener work as a subscription path?
  - does a listener added with `{ once: true }` fire only once?
  - does a listener added with `{ signal }` stop when the signal aborts?

## Subscriptions clean up automatically

- subscriptions registered through subscribe() are tracked internally and removed when destroy() is called; callers do not need to manage them
  - do subscriptions stop firing after destroy()?

## A subscription can transform its value before delivery

- subscribe() accepts an optional parser; the callback receives the parser's output; if the parser throws, the callback receives null for that change and the subscription stays active
  - does the subscriber receive the parser's output rather than the raw value?
  - does a throwing parser not crash the application?
  - does the subscription continue receiving updates after a parser error?

## Multiple keys can be watched in a single subscription

- a subscription can watch a list of keys and fire whenever any one of them changes, delivering a snapshot of all listed keys; when multiple listed keys change inside a batch, the callback fires once
  - does the callback fire when any listed key changes?
  - does it receive a snapshot of all listed key values?
  - does it fire once when multiple listed keys change inside a batch?

## subscriber() produces a live reactive handle

- subscriber(key, parser?) returns a handle that transparently acts like the current value; its properties, methods, and coercions all work without unwrapping; it updates automatically when the property changes
  - does the handle's properties and methods behave as if it were the value itself?
  - does it reflect changes when the property changes?

## Related mutations can be batched to coalesce notifications

- wrapping multiple assignments in batch() causes each subscriber to fire once after all assignments complete; intermediate states are not visible to subscribers
  - does a subscriber fire once when two assignments run inside a batch?
  - does it see the final value rather than an intermediate one?

## A failed batch rolls back completely

- if the function passed to batch() throws, all property changes made inside it are reversed; no subscribers are notified; state is left exactly as it was before the batch
  - does state return to its pre-batch values when the batch function throws?
  - are subscribers not called when the batch function throws?
  - are new keys introduced during a failed batch removed?

## Batches can be deferred to the next microtask

- batchAsync() schedules the same coalescing behavior on the next microtask; it returns a Promise that resolves when the batch completes or rejects, after rollback, if the function throws
  - does batchAsync() defer execution until after the current call stack?
  - does it roll back and reject when the function throws?

## In-place mutations can be re-emitted manually

- notify(key) re-dispatches the current value for a key without a property assignment; use this after mutating a value in place where the reference does not change
  - does notify() deliver the current value to subscribers?
  - does it fire even when the value reference is unchanged?

## Destruction stops all further activity

- destroy() removes all managed subscriptions and prevents any further dispatch; the instance is permanently inert afterward
  - do subscribers not fire after destroy()?
  - is isDestroyed true after destroy()?
  - is calling destroy() twice safe?

---

## derive() produces a derived value from an explicit input list

The selector declares what to watch. The combiner says what to compute. Those two concerns stay separate. The selector runs once at construction to wire subscriptions; the combiner runs whenever any input changes. The result behaves like a live reactive handle with the same transparent proxy behavior as subscriber().

## Inputs are declared once and never change

- the selector runs at construction to discover what to watch; only what is read on that first run becomes a subscription; conditional branches not taken are never subscribed and cannot become subscriptions later
  - does a value not read during the first selector run not trigger recomputation when it changes?

## A selector with no reactive inputs is an error

- if the selector reads nothing reactive, the derivation can never update; this is caught at construction rather than silently producing a value that will never change
  - does derive(() => [42], x => x) throw at construction?

## The combiner receives inputs in selector order

- the combiner is called with the values from the selector array in the same order; its return value is the derived result
  - does the combiner receive values in the order they appear in the selector?

## Subscribers are notified when any input changes

- subscribing to a derivation works like subscribing to a property; the subscriber fires whenever any input changes and the combiner produces a new result
  - does a subscriber fire when an input changes?
  - does it receive the new derived value?

## Memoization skips notification when the result is unchanged

- passing `{ memoize: true }` suppresses notification when the new result is reference-equal to the previous one
  - does a memoized derivation not notify when the result is unchanged?

## Inputs from multiple sources are supported

- the selector can read from any number of Oxject instances; all are subscribed; a change in any of them triggers recomputation
  - does a derivation update when an input from a second Oxject instance changes?

## Derivations can be chained

- reading a derivation's value inside another derivation's selector registers it as an input; the outer derivation updates when the inner one does
  - does a chained derivation update when its upstream derivation updates?

## Batch changes coalesce to one recomputation

- when multiple inputs change inside a batch(), the derivation recomputes once after the batch completes; subscribers receive one notification with the final result
  - does a derivation fire once when two of its inputs change inside a batch?

## Destruction disconnects all inputs

- destroy() removes all input subscriptions; the derived value freezes at its last known state
  - does a derivation subscriber not fire after destroy()?
