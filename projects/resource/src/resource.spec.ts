import { fakeAsync, TestBed, tick } from "@angular/core/testing"
import {
   createResource,
   Fetchable,
   Resource,
   ResourceOptions,
   ResourceState,
   RevalidateOnFocus, RevalidateOnReconnect,
} from "./resource"
import { EMPTY, mapTo, Observable, switchMap, throwError, timer } from "rxjs"
import {
   ChangeDetectionStrategy,
   ChangeDetectorRef,
   Component,
   DoCheck,
   ErrorHandler,
   inject,
   Injectable, Type,
} from "@angular/core"
import createSpy = jasmine.createSpy
import { DOCUMENT } from "@angular/common"

@Injectable({ providedIn: "root" })
class FetchTest implements Fetchable {
   fetch(arg1: number, arg2: number, arg3: number) {
      return timer(500).pipe(mapTo([arg1, arg2, arg3]))
   }
}

@Injectable({ providedIn: "root" })
class FetchTestWithError implements Fetchable {
   fetch(arg1: number, arg2: number, arg3: number) {
      return timer(500).pipe(
         switchMap(() => throwError(() => new Error("Subscribe error"))),
      )
   }
}

const TEST = createResource(FetchTest)
const TEST_WITH_ERROR = createResource(FetchTestWithError)
const TEST_ROOT = createResource(FetchTest, { providedIn: "root" })
const TEST_NOT_PROVIDED = createResource(FetchTest)
const TEST_IMMUTABLE = createResource(FetchTest, {
   immutable: true,
   features: [RevalidateOnFocus, RevalidateOnReconnect]
})

function createTestResource<T extends Fetchable>(fetchable: Type<T>, options?: ResourceOptions): Resource<T> {
   const resource = createResource(fetchable, options)
   TestBed.configureTestingModule({
      providers: [resource]
   })
   return TestBed.inject(resource)
}

@Component({
   template: `
      <div *ngFor="let value of values">
         {{ value }}
      </div>
   `,
   providers: [TEST],
   changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestComponent implements DoCheck {
   resource = inject(TEST).fetch(1, 2, 3)
   values?: number[]

   ngDoCheck() {
      this.values = this.resource.read()
   }
}

@Component({
   template: `
      <div *ngFor="let value of values">
         {{ value }}
      </div>
   `,
   providers: [TEST_IMMUTABLE],
   changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TestImmutableComponent implements DoCheck {
   resource = inject(TEST_IMMUTABLE).fetch(1, 2, 3)
   values?: number[]

   ngDoCheck() {
      this.values = this.resource.read()
   }
}

class MockErrorHandler implements ErrorHandler {
   handleError = jasmine.createSpy("handleError")
}

describe("Resource", () => {
   beforeEach(() => {
      TestBed.configureTestingModule({
         providers: [
            TEST,
            TEST_WITH_ERROR,
            {
               provide: ErrorHandler,
               useClass: MockErrorHandler,
            },
            {
               provide: ChangeDetectorRef,
               useValue: {
                  markForCheck: jasmine.createSpy("markForCheck"),
               },
            },
         ],
      })
   })

   it("should create", () => {
      const resource = TestBed.inject(TEST)
      expect(resource).toBeInstanceOf(TEST)
   })

   it("should fetch resource", () => {
      const resource = TestBed.inject(TEST)
      const fetchTest = TestBed.inject(FetchTest)

      spyOn(fetchTest, "fetch").and.returnValue(EMPTY)
      resource.fetch(1, 2, 3)

      expect(fetchTest.fetch).toHaveBeenCalledTimes(1)
   })

   it("should cast to an observable", fakeAsync(() => {
      const resource = TestBed.inject(TEST)
      resource.fetch(1, 2, 3)
      const spy = jasmine.createSpy()

      resource.asObservable().subscribe(spy)
      resource.read()

      tick(500)
      expect(spy).toHaveBeenCalledWith(resource)
   }))

   describe("read", () => {
      it("should subscribe to resource", () => {
         const resource = TestBed.inject(TEST)

         resource.fetch(1, 2, 3)

         spyOn(resource.source, "subscribe").and.callThrough()
         resource.read()

         expect(resource.source.subscribe).toHaveBeenCalledTimes(1)
      })

      it("should emit values", fakeAsync(() => {
         let result
         const resource = TestBed.inject(TEST)
         resource.fetch(1, 2, 3)

         result = resource.read()
         expect(result).toBeUndefined()

         tick(500)
         result = resource.read()

         expect(result).toEqual([1, 2, 3])
      }))

      it("should not subscribe until the first read", fakeAsync(() => {
         const resource = TestBed.inject(TEST)

         resource.fetch(1, 2, 3)

         spyOn(resource.source, "subscribe").and.callThrough()
         tick(500)

         expect(resource.source.subscribe).not.toHaveBeenCalled()

         resource.read()
         tick(500)
         resource.read()

         expect(resource.source.subscribe).toHaveBeenCalledTimes(1)
      }))

      it("should immediately switch to new subscription on subsequent fetch after first read", fakeAsync(() => {
         const resource = TestBed.inject(TEST)
         const test = resource.fetch(1, 2, 3)

         test.read()
         test.fetch(4, 5, 6)
         tick(500)

         expect(test.value).toEqual([4, 5, 6])
      }))
   })

   describe("errors", () => {
      it("should catch subscribe error", fakeAsync(() => {
         const resource = TestBed.inject(TEST_WITH_ERROR)
         const errorHandler = TestBed.inject(ErrorHandler)
         resource.fetch(1, 2, 3)

         resource.read()
         tick(500)
         resource.read()

         expect(resource.state).toBe(ResourceState.ERROR)
         expect(errorHandler.handleError).toHaveBeenCalledWith(
            new Error("Subscribe error"),
         )
      }))

      it("should catch fetch error", () => {
         const resource = TestBed.inject(TEST_WITH_ERROR)
         const fetchTestWithError = TestBed.inject(FetchTestWithError)
         const errorHandler = TestBed.inject(ErrorHandler)

         spyOn(fetchTestWithError, "fetch").and.callFake(() => {
            throw new Error("Could not fetch resource")
         })
         resource.fetch(1, 2, 3)
         resource.read()

         expect(resource.state).toBe(ResourceState.ERROR)
         expect(errorHandler.handleError).toHaveBeenCalledWith(
            new Error("Could not fetch resource"),
         )
      })
   })

   describe("status", () => {
      it("should get initial status", () => {
         const resource = TestBed.inject(TEST)

         expect(resource.pending).toBeFalse()
         expect(resource.error).toBeFalse()
         expect(resource.complete).toBeFalse()
      })

      it("should be pending after subscribe until a value is received", fakeAsync(() => {
         const resource = TestBed.inject(TEST).fetch(1, 2, 3)

         expect(resource.pending).toBeFalse()

         resource.read()
         expect(resource.pending).toBeTrue()

         tick(500)

         expect(resource.pending).toBeFalse()
      }))

      it("should be pending after subscribe until an error occurs", fakeAsync(() => {
         const resource = TestBed.inject(TEST_WITH_ERROR).fetch(1, 2, 3)

         expect(resource.pending).toBeFalse()

         resource.read()
         expect(resource.pending).toBeTrue()

         tick(500)

         expect(resource.pending).toBeFalse()
         expect(resource.error).toBeTrue()
      }))

      it("should be pending after subscribe until the resource completes", fakeAsync(() => {
         const resource = TestBed.inject(TEST).fetch(1, 2, 3)
         const fetchTest = TestBed.inject(FetchTest)

         spyOn(fetchTest, "fetch").and.returnValue(timer(500) as any)
         expect(resource.pending).toBeFalse()

         resource.fetch(1, 2, 3)
         resource.read()
         expect(resource.pending).toBeTrue()

         tick(500)

         expect(resource.pending).toBeFalse()
         expect(resource.complete).toBeTrue()
      }))
   })

   describe("options", () => {
      it("should provide in root", () => {
         expect(() => TestBed.inject(TEST_ROOT)).not.toThrow()
      })

      it("should override provider name", () => {
         let error: any
         try {
            TestBed.inject(TEST_NOT_PROVIDED)
         } catch (e) {
            error = e
         }
         expect(error?.message).toContain('No provider for Resource<FetchTest>!')
      })

      it("should revalidate on focus", () => {
         const resource = createTestResource(FetchTest, {
            features: [RevalidateOnFocus]
         })
         const fetch = spyOn(TestBed.inject(FetchTest), "fetch").and.callThrough()
         const document = TestBed.inject(DOCUMENT)

         resource.fetch(1, 2, 3).read()
         document.dispatchEvent(new Event("visibilitychange"))

         expect(fetch).toHaveBeenCalledTimes(2)
      })

      it("should revalidate on reconnect", () => {
         const resource = createTestResource(FetchTest, {
            features: [RevalidateOnReconnect]
         })
         const fetch = spyOn(TestBed.inject(FetchTest), "fetch").and.callThrough()
         const document = TestBed.inject(DOCUMENT)

         resource.fetch(1, 2, 3).read()
         document.defaultView?.dispatchEvent(new Event("online"))

         expect(fetch).toHaveBeenCalledTimes(2)
      })
   })

   describe("integration", () => {
      beforeEach(() => {
         TestBed.configureTestingModule({
            declarations: [TestComponent, TestImmutableComponent],
         })
      })

      it("should trigger change detection", fakeAsync(() => {
         const fixture = TestBed.createComponent(TestComponent)
         spyOn(fixture.componentInstance.resource, "read").and.callThrough()

         expect(fixture.componentInstance.resource.read).not.toHaveBeenCalled()
         expect(fixture.componentInstance.values).toBeUndefined()

         fixture.autoDetectChanges()

         expect(fixture.componentInstance.resource.read).toHaveBeenCalledTimes(
            2,
         )
         expect(fixture.componentInstance.values).toBeUndefined()

         tick(500)

         expect(fixture.componentInstance.resource.read).toHaveBeenCalledTimes(
            3,
         )
         expect(fixture.componentInstance.values).toEqual([1, 2, 3])
         expect(fixture.debugElement.nativeElement.textContent).toEqual(
            " 1  2  3 ",
         )
      }))

      it("should dispose resources", () => {
         const fixture = TestBed.createComponent(TestComponent)
         const spy = createSpy()

         fixture.componentInstance.resource.source = new Observable<any>(() => spy)

         fixture.autoDetectChanges()

         expect(spy).not.toHaveBeenCalled()

         fixture.destroy()

         expect(spy).toHaveBeenCalledTimes(1)
      })

      it("should revalidate if stale", fakeAsync(() => {
         const fetch = spyOn(TestBed.inject(FetchTest), "fetch").and.callThrough()
         const fixture = TestBed.createComponent(TestComponent)

         fixture.autoDetectChanges()
         tick(500)

         expect(fetch).toHaveBeenCalledTimes(1)

         const fixture2 = TestBed.createComponent(TestComponent)

         fixture2.autoDetectChanges()
         tick(500)

         expect(fetch).toHaveBeenCalledTimes(2)
      }))

      it("should not revalidate if stale", fakeAsync(() => {
         const fetch = spyOn(TestBed.inject(FetchTest), "fetch").and.callThrough()
         const fixture = TestBed.createComponent(TestImmutableComponent)
         const document = TestBed.inject(DOCUMENT)

         fixture.autoDetectChanges()
         tick(500)

         expect(fetch).toHaveBeenCalledTimes(1)

         const fixture2 = TestBed.createComponent(TestImmutableComponent)

         fixture2.autoDetectChanges()
         tick(500)
         document.dispatchEvent(new Event("visibilitychange"))
         tick(500)
         document.defaultView?.dispatchEvent(new Event("online"))
         tick(500)

         expect(fetch).toHaveBeenCalledTimes(1)
      }))
   })
})
