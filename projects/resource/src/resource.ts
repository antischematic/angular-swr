import {
   ChangeDetectorRef,
   ErrorHandler,
   inject,
   Injectable,
   InjectFlags,
   OnDestroy,
   Type,
} from "@angular/core"
import { EMPTY, map, Observable, ReplaySubject, Subscription } from "rxjs"
import { DOCUMENT } from "@angular/common"

export interface Fetchable<T = unknown> {
   fetch(...args: any[]): Observable<T>
}

export interface ResourceOptions {
   providedIn?: Type<any> | 'root' | 'platform' | 'any' | null
   immutable?: boolean
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
   ACTIVE,
   ERROR,
   COMPLETE,
}

export class ResourceSubject<T extends Fetchable<any> = Fetchable> extends ReplaySubject<Resource<T>> {
   override next(value: [any, FetchValue<T>]): void
   override next(resource: never): void
   override next([cacheKey, value]: any): void {
      const { resource, changeDetectorRef } = this
      resource.value = value
      resource.state = ResourceState.ACTIVE
      resource.pending = false
      if (cacheKey !== null && cacheKey !== undefined) {
         resource.cache.set(cacheKey, value)
      }
      changeDetectorRef.markForCheck()
      super.next(resource)
   }

   override error(error: unknown) {
      const { resource } = this
      resource.state = ResourceState.ERROR
      resource.pending = false
      resource.thrownError = error
      super.next(resource)
   }

   override complete() {
      const { resource } = this
      resource.state = ResourceState.COMPLETE
      resource.pending = false
      super.next(resource)
   }

   constructor(private resource: Resource<T>, private cache: Map<any, any>, private changeDetectorRef: ChangeDetectorRef) {
      super(1)
   }
}

const defaultOptions: ResourceOptions = {}

@Injectable({ providedIn: "root" })
export class CacheRegistry {
   private readonly registry = new Map()
   get(target: any, cacheStrategy = new Map()) {
      return this.registry.get(target) ?? this.registry.set(target, cacheStrategy).get(target)
   }
}

@Injectable()
export abstract class Resource<T extends Fetchable<any> = Fetchable>
   implements OnDestroy
{
   private readonly errorHandler: ErrorHandler
   private readonly observer: ResourceSubject<T>
   private readonly middlewares: ResourceFeature<T>[]
   private connected: boolean
   private subscription: Subscription
   readonly cache: Map<any, any>
   params?: FetchParameters<T>

   #value?: FetchValue<T>
   state: ResourceState
   thrownError: unknown
   source: Observable<[any, FetchValue<T>]>
   pending: boolean

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

   next(value: FetchValue<T>) {
      this.observer.next([null, value])
   }

   fetch(...params: FetchParameters<T>) {
      try {
         const shouldConnect = this.state !== ResourceState.EMPTY
         const cacheKey = this.getCacheKey()
         const hasCache = this.cache.has(cacheKey)
         this.params = params
         if (hasCache) {
            this.next(this.cache.get(cacheKey))
         }
         if (!this.options.immutable || !hasCache) {
            this.state = ResourceState.READY
            this.source = this.fetchable.fetch(...params)
               .pipe(map((value) => [cacheKey, value]))
            if (shouldConnect) {
               this.disconnect()
               this.connect()
            }
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

   init() {
      for (const middleware of this.middlewares) {
         middleware.onInit?.(this)
      }
   }

   connect() {
      if (!this.connected) {
         this.connected = true
         this.thrownError = undefined
         this.pending = true
         this.subscription = this.source.subscribe(this.observer)
         for (const middleware of this.middlewares) {
            middleware.onConnect?.(this)
         }
      }
   }

   disconnect() {
      if (this.connected) {
         this.connected = false
         this.subscription.unsubscribe()
         for (const middleware of this.middlewares) {
            middleware.onDisconnect?.(this)
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
         this.cache.delete(this.getCacheKey())
      }
   }

   getCacheKey() {
      return this.options.serialize?.(this.params) ?? JSON.stringify(this.params)
   }

   asObservable() {
      return this.observer.asObservable()
   }

   ngOnDestroy() {
      this.disconnect()
   }

   protected constructor(
      private fetchable: T,
      private options: ResourceOptions = defaultOptions,
   ) {
      this.cache = inject(CacheRegistry).get(new.target)
      this.observer = new ResourceSubject<T>(this, this.cache, inject(ChangeDetectorRef, InjectFlags.Self)!)
      this.errorHandler = inject(ErrorHandler)
      this.source = EMPTY
      this.state = ResourceState.EMPTY
      this.subscription = Subscription.EMPTY
      this.connected = false
      this.pending = false
      this.middlewares = options.features ? options.features.map(token => inject(token)) : []

      this.init()
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
         super(
            inject(fetchable),
            options,
         )
      }
   }
   return ResourceImpl
}

interface ResourceFeature<T extends Fetchable> {
   onInit?(resource: Resource<T>): void
   onConnect?(resource: Resource<T>): void
   onDisconnect?(resource: Resource<T>): void
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
