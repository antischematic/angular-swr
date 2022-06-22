import {
   ChangeDetectorRef,
   ErrorHandler,
   inject,
   Injectable,
   InjectFlags,
   OnDestroy,
   Type,
} from "@angular/core"
import {
   catchError,
   EMPTY,
   merge,
   Observable,
   PartialObserver,
   shareReplay,
   Subject,
   Subscription,
   takeUntil,
} from "rxjs"
import { DOCUMENT } from "@angular/common"

export interface Fetchable<T = unknown> {
   fetch(...args: any[]): Observable<T>
}

export interface ResourceOptions {
   providedIn?: Type<any> | "root" | "platform" | "any" | null
   immutable?: boolean
   timeoutMs?: number
   dedupeIntervalMs?: number
   serialize?: (...params: any[]) => string
   features?: Type<ResourceFeature<any>>[]
}

type FetchParameters<T extends Fetchable> = Parameters<T["fetch"]>
type FetchObservable<T extends Fetchable> = ReturnType<T["fetch"]>
type FetchValue<T extends Fetchable> = FetchObservable<T> extends Observable<
   infer R
>
   ? R
   : never

export enum ResourceState {
   EMPTY,
   READY,
   SLOW,
   ACTIVE,
   ERROR,
   COMPLETE,
}

export class ResourceSubject<T extends Fetchable<any> = Fetchable> {
   next(value: FetchValue<T>): void {
      this.emit(ResourceState.ACTIVE, value, false, null)
   }

   error(error: unknown) {
      this.emit(ResourceState.ERROR, null, false, error)
   }

   complete() {
      this.emit(ResourceState.COMPLETE, null, false, null)
   }

   emit(
      state: ResourceState,
      value: any,
      pending: boolean,
      thrownError: unknown,
   ) {
      const { resource, subject, changeDetectorRef } = this
      resource.state = state
      resource.pending = pending
      resource.slow = state === ResourceState.SLOW
      resource.timeout = undefined
      switch (state) {
         case ResourceState.ACTIVE: {
            resource.value = value
            break
         }
         case ResourceState.ERROR: {
            resource.thrownError = thrownError
            break
         }
      }
      changeDetectorRef.markForCheck()
      subject.next(resource)
   }

   asObservable() {
      return this.subject.asObservable()
   }

   constructor(
      private resource: Resource<T>,
      private cache: Map<any, any>,
      private subject: Subject<any>,
      private changeDetectorRef: ChangeDetectorRef,
   ) {}
}

const defaultOptions: ResourceOptions = {}

function createFetchObservable(
   cacheKey: string,
   previous: Observable<any>,
   source: Observable<any>,
   errorHandler: ErrorHandler,
) {
   const next = source.pipe(shareReplay(1))
   previous = previous.pipe(
      takeUntil(next),
      catchError((error) => {
         errorHandler.handleError(error)
         return EMPTY
      }),
   )
   return merge(previous, next)
}

@Injectable({ providedIn: "root" })
export class CacheRegistry {
   private readonly registry = new Map()
   get(target: any, cacheStrategy = new Map()) {
      const cache = this.registry.get(target)
      if (cache) {
         return cache
      } else {
         this.registry.set(target, cacheStrategy)
         return cacheStrategy
      }
   }
}

function isWithinDedupeInterval(then: number, dedupeIntervalMs: number) {
   return Date.now() - then < dedupeIntervalMs
}

@Injectable()
export abstract class Resource<T extends Fetchable<any> = Fetchable>
   implements OnDestroy
{
   private readonly errorHandler: ErrorHandler
   private readonly observer: ResourceSubject<T>
   private readonly features: ResourceFeature<T>[]
   private connected: boolean
   private subscription: Subscription
   readonly cache: Map<any, any>

   #value?: FetchValue<T>
   params?: FetchParameters<T>
   state: ResourceState
   thrownError: unknown
   source: Observable<FetchValue<T>>
   pending: boolean
   timeout?: number
   slow: boolean

   get value() {
      return this.read()
   }

   set value(value) {
      this.#value = value
   }

   get error() {
      return this.state === ResourceState.ERROR
   }

   get complete() {
      return this.state === ResourceState.COMPLETE
   }

   next(value?: FetchValue<T>) {
      this.observer.emit(this.state, value, this.pending, this.thrownError)
   }

   fetch(...params: FetchParameters<T>) {
      try {
         const cacheKey = this.getCacheKey(params)
         const hasCache = this.cache.has(cacheKey)
         const shouldDedupe = isWithinDedupeInterval(this.cache.get(cacheKey + 'dedupe'), this.options.dedupeIntervalMs ?? 2000)
         const shouldConnect = this.state !== ResourceState.EMPTY
         this.state = ResourceState.READY
         this.params = params
         if (hasCache) {
            this.source = this.cache.get(cacheKey)
         }
         if ((!this.options.immutable || !hasCache) && !shouldDedupe) {
            const source = createFetchObservable(
               cacheKey,
               this.source,
               this.fetchable.fetch(...params),
               this.errorHandler,
            )
            this.cache.set(cacheKey + 'dedupe', Date.now())
            this.cache.set(cacheKey, source)
            this.source = source
         }
         if (shouldConnect) {
            this.disconnect()
            this.connect()
         }
      } catch (error) {
         this.observer.error(error)
      }
      return this
   }

   read(): FetchValue<T> | undefined {
      switch (this.state) {
         case ResourceState.ERROR: {
            this.errorHandler.handleError(this.thrownError)
            break
         }
         case ResourceState.READY:
            this.connect()
            break
      }
      return this.#value
   }

   connect() {
      if (!this.connected) {
         const { timeoutMs } = this.options
         this.connected = true
         this.thrownError = undefined
         this.pending = true
         if (timeoutMs) {
            this.timeout = setTimeout(Resource.slow, timeoutMs, this)
         }
         this.subscription = this.source.subscribe(this.observer)
         for (const feature of this.features) {
            feature.onConnect?.(this)
         }
      }
   }

   disconnect() {
      if (this.connected) {
         this.connected = false
         this.subscription.unsubscribe()
         for (const feature of this.features) {
            feature.onDisconnect?.(this)
         }
      }
   }

   revalidate() {
      if (this.params) {
         this.fetch(...this.params)
      }
      return this
   }

   invalidate(all: boolean) {
      if (all) {
         this.cache.clear()
      } else {
         const cacheKey = this.getCacheKey(this.params)
         this.cache.delete(cacheKey)
         this.cache.delete(cacheKey + 'dedupe')
      }
      return this
   }

   getCacheKey(params: any) {
      return this.options.serialize?.(params) ?? JSON.stringify(params)
   }

   asObservable() {
      return this.observer.asObservable()
   }

   subscribe(observer?: PartialObserver<this>): Subscription
   subscribe(observer?: (value: this) => void): Subscription
   subscribe(
      observer?: ((value: Resource<T>) => void) & PartialObserver<this>,
   ) {
      return this.asObservable().subscribe(observer)
   }

   ngOnDestroy() {
      this.disconnect()
      for (const feature of this.features) {
         feature.onDestroy?.(this)
      }
   }

   protected constructor(
      private fetchable: T,
      private options: ResourceOptions = defaultOptions,
   ) {
      this.cache = inject(CacheRegistry).get(new.target)
      this.observer = new ResourceSubject<T>(
         this,
         this.cache,
         new Subject(),
         inject(ChangeDetectorRef, InjectFlags.Self)!,
      )
      this.errorHandler = inject(ErrorHandler)
      this.source = EMPTY
      this.state = ResourceState.EMPTY
      this.subscription = Subscription.EMPTY
      this.connected = false
      this.pending = false
      this.slow = false
      this.features = options.features
         ? options.features.map((token) => inject(token))
         : []

      for (const feature of this.features) {
         feature.onInit?.(this)
      }
   }

   private static slow(resource: Resource) {
      if (resource) {
         resource.observer.emit(
            ResourceState.SLOW,
            resource.#value,
            resource.pending,
            resource.thrownError,
         )
      }
   }
}

export function createResource<T extends Fetchable<any>>(
   fetchable: Type<T>,
   options: ResourceOptions = defaultOptions,
): Type<Resource<T>> {
   @Injectable({ providedIn: options.providedIn ?? null })
   class ResourceImpl extends Resource<T> {
      static overriddenName = `Resource<${fetchable.name}>`
      constructor() {
         super(inject(fetchable), options)
      }
   }
   return ResourceImpl
}

interface ResourceFeature<T extends Fetchable> {
   onInit?(resource: Resource<T>): void
   onConnect?(resource: Resource<T>): void
   onDisconnect?(resource: Resource<T>): void
   onDestroy?(resource: Resource<T>): void
}

@Injectable({ providedIn: "root" })
export class RevalidateOnFocus implements ResourceFeature<any>, OnDestroy {
   private document = inject(DOCUMENT)
   private resources = new Set<Resource>()

   handleEvent() {
      if (this.document.visibilityState === "visible") {
         for (const resource of Array.from(this.resources)) {
            resource.revalidate()
         }
      }
   }

   onConnect(resource: Resource): void {
      this.resources.add(resource)
   }

   onDisconnect(resource: Resource): void {
      this.resources.delete(resource)
   }

   ngOnDestroy() {
      this.document.removeEventListener("visibilitychange", this)
   }

   constructor() {
      this.document.addEventListener("visibilitychange", this)
   }
}

@Injectable({ providedIn: "root" })
export class RevalidateOnReconnect implements ResourceFeature<any>, OnDestroy {
   private document = inject(DOCUMENT)
   private resources = new Set<Resource>()

   handleEvent() {
      for (const resource of Array.from(this.resources)) {
         resource.revalidate()
      }
   }

   onConnect(resource: Resource): void {
      this.resources.add(resource)
   }

   onDisconnect(resource: Resource): void {
      this.resources.delete(resource)
   }

   ngOnDestroy() {
      this.document.defaultView?.removeEventListener("online", this)
   }

   constructor() {
      this.document.defaultView?.addEventListener("online", this)
   }
}
