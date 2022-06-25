import { fakeAsync, TestBed, tick } from "@angular/core/testing"
import {
   createResource,
   defaultOptions,
   Fetchable,
   refreshInterval,
   Resource,
   ResourceState,
   revalidateOnFocus,
   revalidateOnReconnect,
} from "./resource"
import { EMPTY, interval, Observable, of, throwError } from "rxjs"
import { delay, take } from "rxjs/operators"
import { ChangeDetectorRef, Injectable, Type } from "@angular/core"
import { DOCUMENT } from "@angular/common"
import createSpy = jasmine.createSpy

@Injectable({ providedIn: "root" })
export class MockFetch {
   fetch(..._: any[]): Observable<any> {
      return EMPTY
   }
}

function mockFetch(fetchable: Type<Fetchable>) {
   return spyOn(TestBed.inject(fetchable), "fetch")
}

function configureTest() {
   return TestBed.configureTestingModule({
      providers: [
         {
            provide: ChangeDetectorRef,
            useValue: { markForCheck: createSpy("markForCheck") },
         },
      ],
   })
}

function spyOnObservable<T extends Observable<any>>(source: T) {
   spyOn(source as Observable<any>, "subscribe").and.callThrough()
   return source
}

const TEST = createResource(MockFetch, {
   providedIn: "root",
   timeoutMs: defaultOptions.timeoutMs,
   dedupeMs: defaultOptions.dedupeMs,
   features: [revalidateOnFocus],
})
const syncValue = of(1337)
const delayedValue = of(1337).pipe(delay(500))
const threeValues = interval(500).pipe(take(3))
const slowValue = of(1337).pipe(delay(5000))

describe("Resource", () => {
   beforeEach(configureTest)

   it("should create", () => {
      expect(TestBed.inject(TEST)).toBeTruthy()
   })

   it("should not immediately subscribe", () => {
      const source = spyOnObservable(delayedValue)
      const resource = TestBed.inject(TEST)

      mockFetch(MockFetch).and.returnValue(source)
      resource.fetch()

      expect(source.subscribe).not.toHaveBeenCalled()
   })

   it("should subscribe on first read", fakeAsync(() => {
      const source = spyOnObservable(delayedValue)
      const resource = TestBed.inject(TEST)

      mockFetch(MockFetch).and.returnValue(source)
      resource.fetch(1)
      resource.fetch(2)
      resource.read()

      tick(500)

      expect(source.subscribe).toHaveBeenCalledTimes(1)
      expect(resource.value).toBe(1337)
   }))

   it("should subscribe on first value access", fakeAsync(() => {
      const source = spyOnObservable(delayedValue)
      const resource = TestBed.inject(TEST)
      mockFetch(MockFetch).and.returnValue(source)

      resource.fetch(1)
      resource.fetch(2)
      expect(resource.value).toBeUndefined()
      tick(500)

      expect(source.subscribe).toHaveBeenCalledTimes(1)
      expect(resource.value).toBe(1337)
   }))

   it("should subscribe on subsequent fetch", fakeAsync(() => {
      const source = spyOnObservable(delayedValue)
      const resource = TestBed.inject(TEST)
      mockFetch(MockFetch).and.returnValue(source)

      resource.fetch(1).read()
      resource.fetch(2)
      tick(500)

      expect(source.subscribe).toHaveBeenCalledTimes(2)
      expect(resource.value).toBe(1337)
   }))

   it("should trigger change detection", fakeAsync(() => {
      const source = spyOnObservable(threeValues)
      const resource = TestBed.inject(TEST)
      const changeDetector = TestBed.inject(ChangeDetectorRef)
      mockFetch(MockFetch).and.returnValue(source)

      resource.fetch()
      resource.read()
      tick(500)

      expect(changeDetector.markForCheck).toHaveBeenCalledTimes(1)

      tick(500)

      expect(changeDetector.markForCheck).toHaveBeenCalledTimes(2)

      tick(500)

      expect(changeDetector.markForCheck).toHaveBeenCalledTimes(4)
   }))

   it("should revalidate on mount", fakeAsync(() => {
      const FRESH = createResource(MockFetch, {
         revalidateIfStale: true,
         dedupeMs: 0,
         providedIn: "root",
      })
      // noinspection DuplicatedCode
      class STALE extends Resource {}
      TestBed.configureTestingModule({
         providers: [{ provide: STALE, useClass: FRESH }],
      })
      const source = spyOnObservable(syncValue)
      mockFetch(MockFetch).and.returnValue(source)
      const fresh = TestBed.inject(FRESH)

      fresh.fetch()
      fresh.read()

      expect(source.subscribe).toHaveBeenCalledTimes(1)

      const stale = TestBed.inject(STALE)

      stale.fetch()
      stale.read()

      expect(source.subscribe).toHaveBeenCalledTimes(2)
   }))

   it("should complete subject when destroyed", () => {
      const resource = TestBed.inject(TEST)
      const subscription = resource.subscribe()
      TestBed.resetTestingModule()
      expect(subscription.closed).toBeTrue()
   })

   describe("states", () => {
      it("should be initial", () => {
         const resource = TestBed.inject(TEST)
         resource.fetch()
         expect(resource.state).toBe(ResourceState.INITIAL)
         expect(resource.pending).toBeFalse()
         expect(resource.slow).toBeFalse()
         expect(resource.complete).toBeFalse()
         expect(resource.error).toBeFalse()
      })

      it("should be fetch", () => {
         mockFetch(MockFetch).and.returnValue(threeValues)
         const resource = TestBed.inject(TEST)
         resource.fetch()
         resource.read()
         expect(resource.state).toBe(ResourceState.FETCH)
         expect(resource.pending).toBeTrue()
         expect(resource.slow).toBeFalse()
         expect(resource.complete).toBeFalse()
         expect(resource.error).toBeFalse()
      })

      it("should be next", fakeAsync(() => {
         mockFetch(MockFetch).and.returnValue(threeValues)
         const resource = TestBed.inject(TEST)
         resource.fetch()
         resource.read()

         expect(resource.pending).toBeTrue()
         expect(resource.slow).toBeFalse()
         expect(resource.complete).toBeFalse()
         expect(resource.error).toBeFalse()
         tick(500)

         expect(resource.state).toBe(ResourceState.NEXT)
         expect(resource.pending).toBeFalse()
         expect(resource.slow).toBeFalse()
         expect(resource.complete).toBeFalse()
         expect(resource.error).toBeFalse()
         tick(1000)
      }))

      it("should be complete", () => {
         mockFetch(MockFetch).and.returnValue(EMPTY)
         const resource = TestBed.inject(TEST)

         resource.fetch()
         resource.read()

         expect(resource.state).toBe(ResourceState.COMPLETE)
         expect(resource.pending).toBeFalse()
         expect(resource.slow).toBeFalse()
         expect(resource.complete).toBeTrue()
         expect(resource.error).toBeFalse()
      })

      it("should be error", () => {
         mockFetch(MockFetch).and.returnValue(
            throwError(() => new Error("BOGUS")),
         )
         const resource = TestBed.inject(TEST)

         resource.fetch()
         resource.read()

         expect(resource.state).toBe(ResourceState.ERROR)
         expect(resource.pending).toBeFalse()
         expect(resource.slow).toBeFalse()
         expect(resource.complete).toBeFalse()
         expect(resource.error).toBeTrue()
      })

      it("should be slow", fakeAsync(() => {
         mockFetch(MockFetch).and.returnValue(slowValue)
         const resource = TestBed.inject(TEST)

         resource.fetch()
         resource.read()
         tick(3000)

         expect(resource.pending).toBeTrue()
         expect(resource.slow).toBeTrue()
         expect(resource.complete).toBeFalse()
         expect(resource.error).toBeFalse()
         expect(resource.state).toBe(ResourceState.SLOW)

         tick(2000)

         expect(resource.slow).toBeFalse()
         expect(resource.state).toBe(ResourceState.COMPLETE)
      }))

      it("should work without change detector ref", () => {
         TestBed.resetTestingModule()
         expect(() => TestBed.inject(TEST)).not.toThrow()
      })
   })

   describe("options", () => {
      it("should not revalidate within dedupe interval when cached", fakeAsync(() => {
         const DEDUPE = createResource(MockFetch, {
            dedupeMs: defaultOptions.dedupeMs,
            providedIn: "root",
         })
         const source = spyOnObservable(syncValue)
         const resource = TestBed.inject(DEDUPE)
         mockFetch(MockFetch).and.returnValue(source)

         resource.fetch().read()
         resource.fetch()

         expect(source.subscribe).toHaveBeenCalledTimes(1)

         resource.fetch(1)
         resource.fetch(1)
         resource.fetch()

         expect(source.subscribe).toHaveBeenCalledTimes(2)

         tick(defaultOptions.dedupeMs)
         resource.fetch()

         expect(source.subscribe).toHaveBeenCalledTimes(3)
      }))

      it("should always revalidate when dedupe is disabled", () => {
         const NO_DEDUPE = createResource(MockFetch, {
            dedupeMs: 0,
            providedIn: "root",
         })
         const source = spyOnObservable(syncValue)
         const resource = TestBed.inject(NO_DEDUPE)
         mockFetch(MockFetch).and.returnValue(source)

         resource.fetch()
         resource.read()
         resource.revalidate()
         resource.revalidate()

         expect(source.subscribe).toHaveBeenCalledTimes(3)
      })

      it("should never revalidate when cached", () => {
         const IMMUTABLE = createResource(MockFetch, {
            immutable: true,
            dedupeMs: 0,
            providedIn: "root",
         })
         const source = spyOnObservable(syncValue)
         const resource = TestBed.inject(IMMUTABLE)
         mockFetch(MockFetch).and.returnValue(source)

         resource.fetch()
         resource.read()
         resource.revalidate()
         resource.revalidate()

         expect(source.subscribe).toHaveBeenCalledTimes(1)
      })

      it("should use a custom param serializer", () => {
         const SERIALIZE = createResource(MockFetch, {
            serialize: (params) => params + "1337",
            providedIn: "root",
         })
         const resource = TestBed.inject(SERIALIZE)

         expect(resource.getCacheKey("BOGUS")).toBe("BOGUS1337")
      })

      it("should not provide token by default", () => {
         const NOT_PROVIDED = createResource(MockFetch)
         expect(() => TestBed.inject(NOT_PROVIDED)).toThrow()
      })

      it("should provide token in root injector", () => {
         const PROVIDED_IN_ROOT = createResource(MockFetch, {
            providedIn: "root",
         })
         expect(() => TestBed.inject(PROVIDED_IN_ROOT)).not.toThrow()
      })

      it("should not revalidate on mount", () => {
         const FRESH = createResource(MockFetch, {
            revalidateIfStale: false,
            dedupeMs: 0,
            providedIn: "root",
         })
         class STALE extends Resource {}
         TestBed.configureTestingModule({
            providers: [{ provide: STALE, useClass: FRESH }],
         })
         const source = spyOnObservable(syncValue)
         mockFetch(MockFetch).and.returnValue(source)
         const fresh = TestBed.inject(FRESH)

         fresh.fetch()
         fresh.read()

         expect(source.subscribe).toHaveBeenCalledTimes(1)

         const stale = TestBed.inject(STALE)

         stale.fetch()
         stale.read()

         expect(source.subscribe).toHaveBeenCalledTimes(1)
      })

      it("should never cache", () => {
         const NO_CACHE = createResource(MockFetch, { cache: false, providedIn: "root" })
         const source = spyOnObservable(syncValue)
         mockFetch(MockFetch).and.returnValue(source)
         const noCache = TestBed.inject(NO_CACHE)

         noCache.fetch()
         noCache.read()
         noCache.fetch()
         noCache.fetch()

         expect(source.subscribe).toHaveBeenCalledTimes(3)
      })
   })

   describe("features", () => {
      it("should revalidate on window focus", () => {
         const REVALIDATE = createResource(MockFetch, {
            features: [revalidateOnFocus],
            dedupeMs: 0,
            providedIn: "root",
         })
         const source = spyOnObservable(syncValue)
         const resource = TestBed.inject(REVALIDATE)
         const document = TestBed.inject(DOCUMENT)
         mockFetch(MockFetch).and.returnValue(source)

         resource.fetch()
         resource.read()

         expect(source.subscribe).toHaveBeenCalledTimes(1)

         document.dispatchEvent(new Event("visibilitychange"))

         expect(source.subscribe).toHaveBeenCalledTimes(2)
      })

      it("should revalidate on reconnect", () => {
         const RECONNECT = createResource(MockFetch, {
            features: [revalidateOnReconnect],
            dedupeMs: 0,
            providedIn: "root",
         })
         const source = spyOnObservable(syncValue)
         const resource = TestBed.inject(RECONNECT)
         const document = TestBed.inject(DOCUMENT)
         mockFetch(MockFetch).and.returnValue(source)

         resource.fetch()
         resource.read()

         expect(source.subscribe).toHaveBeenCalledTimes(1)

         document.defaultView?.dispatchEvent(new Event("online"))

         expect(source.subscribe).toHaveBeenCalledTimes(2)
      })

      it("should revalidate on interval", fakeAsync(() => {
         const INTERVAL = createResource(MockFetch, {
            features: [refreshInterval(60000)],
            dedupeMs: 0,
            timeoutMs: 0,
            providedIn: "root",
         })
         const source = spyOnObservable(syncValue)
         mockFetch(MockFetch).and.returnValue(source)
         const resource = TestBed.inject(INTERVAL)

         resource.fetch()
         resource.read()

         expect(source.subscribe).toHaveBeenCalledTimes(1)

         tick(60000)

         expect(source.subscribe).toHaveBeenCalledTimes(2)

         TestBed.resetTestingModule()
      }))
   })
})
