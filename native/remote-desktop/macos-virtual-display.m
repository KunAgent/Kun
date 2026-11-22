#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#include <stdio.h>
#include <stdatomic.h>
#include <unistd.h>

// WindowServer exposes these Objective-C classes on supported Macs. Resolve them at runtime
// so a missing implementation never prevents normal physical-display sharing from launching.
@interface KunDisplayDescriptor : NSObject
@property(nonatomic, strong) NSString *name;
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic) unsigned int vendorID, productID, serialNum, serialNumber, maxPixelsWide, maxPixelsHigh;
@property(nonatomic) CGSize sizeInMillimeters;
@property(nonatomic) CGPoint whitePoint, redPrimary, greenPrimary, bluePrimary;
@end
@interface KunDisplayMode : NSObject
- (instancetype)initWithWidth:(unsigned int)width height:(unsigned int)height refreshRate:(double)rate;
@end
@interface KunDisplaySettings : NSObject
@property(nonatomic) unsigned int hiDPI;
@property(nonatomic, strong) NSArray *modes;
@end
@interface KunOwnedDisplay : NSObject
- (instancetype)initWithDescriptor:(id)descriptor;
- (BOOL)applySettings:(id)settings;
@property(nonatomic, readonly) CGDirectDisplayID displayID;
@end

static Class cls(NSString *name) { return NSClassFromString(name); }
typedef struct { unsigned w, h; size_t pw, ph; } DisplaySize;
static DisplaySize applied;
static atomic_uint monitorID, geometryEpoch, acceptedW, acceptedH, acceptedPW, acceptedPH;
static BOOL independentDisplay(CGDirectDisplayID did) {
    if (!did || CGDisplayIsInMirrorSet(did)) return NO;
    if (!CGDisplayIsMain(did)) return YES;
    uint32_t count = 0;
    return CGGetOnlineDisplayList(0, NULL, &count) == kCGErrorSuccess && count == 1;
}
static void checkOwnedDisplay(void) {
    unsigned did = atomic_load(&monitorID), epoch = atomic_load(&geometryEpoch);
    if (!did) return;
    if (!independentDisplay(did)) _exit(6);
    if (epoch & 1) return;
    CGRect bounds = CGDisplayBounds(did);
    CGDisplayModeRef mode = CGDisplayCopyDisplayMode(did);
    BOOL valid = mode && CGDisplayIsOnline(did) && bounds.size.width == atomic_load(&acceptedW) &&
        bounds.size.height == atomic_load(&acceptedH) && CGDisplayModeGetPixelWidth(mode) == atomic_load(&acceptedPW) &&
        CGDisplayModeGetPixelHeight(mode) == atomic_load(&acceptedPH);
    if (mode) CGDisplayModeRelease(mode);
    if (!valid && epoch == atomic_load(&geometryEpoch)) _exit(6);
}
static void displayChanged(CGDirectDisplayID did, CGDisplayChangeSummaryFlags flags, void *context) {
    if (did == atomic_load(&monitorID) && !(flags & kCGDisplayBeginConfigurationFlag)) checkOwnedDisplay();
}
int kun_display_supported(void) {
    return [cls(@"CGVirtualDisplay") instancesRespondToSelector:@selector(applySettings:)] &&
           [cls(@"CGVirtualDisplay") instancesRespondToSelector:@selector(initWithDescriptor:)] &&
           [cls(@"CGVirtualDisplayDescriptor") instancesRespondToSelector:@selector(setQueue:)] &&
           [cls(@"CGVirtualDisplayMode") instancesRespondToSelector:@selector(initWithWidth:height:refreshRate:)] &&
           [cls(@"CGVirtualDisplaySettings") instancesRespondToSelector:@selector(setModes:)];
}

static KunOwnedDisplay *createDisplay(unsigned w, unsigned h) {
    KunDisplayDescriptor *d = [[cls(@"CGVirtualDisplayDescriptor") alloc] init];
    d.name = @"Kun Mobile"; d.queue = dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0);
    d.vendorID = 0x4b55; d.productID = 0x4d4f;
    unsigned serial = arc4random_uniform(UINT32_MAX - 1) + 1;
    d.serialNum = serial;
    if ([d respondsToSelector:@selector(setSerialNumber:)]) d.serialNumber = serial;
    d.maxPixelsWide = 4096; d.maxPixelsHigh = 4096;
    d.sizeInMillimeters = CGSizeMake(w * 25.4 / 120.0, h * 25.4 / 120.0);
    d.whitePoint = CGPointMake(0.3127, 0.3290); d.redPrimary = CGPointMake(0.64, 0.33);
    d.greenPrimary = CGPointMake(0.30, 0.60); d.bluePrimary = CGPointMake(0.15, 0.06);
    return [[cls(@"CGVirtualDisplay") alloc] initWithDescriptor:d];
}

static BOOL applyMode(KunOwnedDisplay *display, unsigned w, unsigned h, BOOL retina) {
    CGDirectDisplayID did = display.displayID;
    if (!independentDisplay(did)) return NO;
    KunDisplayMode *mode = [[cls(@"CGVirtualDisplayMode") alloc] initWithWidth:w height:h refreshRate:60.0];
    KunDisplaySettings *settings = [[cls(@"CGVirtualDisplaySettings") alloc] init];
    if (!mode || !settings) return NO;
    settings.hiDPI = retina; settings.modes = @[mode];
    if (![display applySettings:settings]) return NO;
    // Applying a mode is asynchronous. Report the actual backing pixels and logical bounds
    // of our display only after WindowServer agrees with the requested geometry.
    for (int i = 0; i < 20; ++i) {
        CGDisplayModeRef current = CGDisplayCopyDisplayMode(did);
        CGFloat lw = CGDisplayBounds(did).size.width, lh = CGDisplayBounds(did).size.height;
        size_t pw = current ? CGDisplayModeGetPixelWidth(current) : 0, ph = current ? CGDisplayModeGetPixelHeight(current) : 0;
        if (current) CGDisplayModeRelease(current);
        if (!independentDisplay(did)) return NO;
        BOOL exact = lw == w && lh == h;
        BOOL scaled = (w < 640 || h < 480 || !retina) && i >= 8 && lw == 2*w && lh == 2*h &&
                      lw <= 3840 && lh <= 3840 && lw*lh <= 8294400;
        if (CGDisplayIsOnline(did) && (exact || scaled) && pw && ph && pw <= 4096 && ph <= 4096) {
            applied = (DisplaySize){ (unsigned)lw, (unsigned)lh, pw, ph };
            return YES;
        }
        // A display-mode override can pin the old geometry across applySettings. Let
        // WindowServer deliver the reconfiguration on its run loop instead.
        CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.025, true);
        [NSThread sleepForTimeInterval:0.015];
    }
    return NO;
}
static BOOL configure(KunOwnedDisplay *display, unsigned w, unsigned h) {
    BOOL retina = w <= 2048 && h <= 2048 && (uint64_t)w*h*4 <= 8294400;
    if (applyMode(display, w, h, retina)) return YES;
    if (retina && w >= 640 && h >= 480 && applyMode(display, w, h, NO)) return YES;
    // WindowServer can refuse low logical modes on some Macs. Keep the aspect ratio
    // and return the actual canvas, including any HiDPI backing scale.
    double factor = MAX(800.0 / w, 600.0 / h);
    unsigned fw = (unsigned)lround(w * factor), fh = (unsigned)lround(h * factor);
    if (factor <= 1 || fw > 3840 || fh > 3840 || (uint64_t)fw*fh > 8294400) return NO;
    BOOL dense = fw <= 2048 && fh <= 2048 && (uint64_t)fw*fh*4 <= 8294400;
    return applyMode(display, fw, fh, dense) || (dense && applyMode(display, fw, fh, NO));
}

int kun_display_run(void) {
    @autoreleasepool {
        if (!kun_display_supported()) return 2;
        BOOL observing = NO;
        dispatch_source_t watch = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
        dispatch_source_set_timer(watch, dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC), 250 * NSEC_PER_MSEC, 25 * NSEC_PER_MSEC);
        dispatch_source_set_event_handler(watch, ^{ checkOwnedDisplay(); }); dispatch_resume(watch);
        KunOwnedDisplay *display = nil;
        unsigned previousW = 0, previousH = 0;
        char line[64], extra;
        while (fgets(line, sizeof(line), stdin)) {
            @autoreleasepool { @try {
                unsigned w, h;
                if (sscanf(line, "size %u %u %c", &w, &h, &extra) != 2 || w < 320 || h < 240 ||
                    w > 3840 || h > 3840 || (uint64_t)w*h > 8294400) return 3;
                atomic_fetch_add(&geometryEpoch, 1);
                if (!display) {
                    display = createDisplay(w, h);
                    if (!display || !display.displayID) return 4;
                    atomic_store(&monitorID, display.displayID);
                    printf("owned %u\n", display.displayID); fflush(stdout);
                }
                DisplaySize previous = applied;
                BOOL accepted = configure(display, w, h);
                if (!accepted) {
                    if (!previousW || !configure(display, previousW, previousH) || applied.w != previous.w ||
                        applied.h != previous.h || applied.pw != previous.pw || applied.ph != previous.ph) return 4;
                } else { previousW = w; previousH = h; }
                atomic_store(&acceptedW, applied.w); atomic_store(&acceptedH, applied.h);
                atomic_store(&acceptedPW, applied.pw); atomic_store(&acceptedPH, applied.ph);
                atomic_fetch_add(&geometryEpoch, 1);
                // Registering before the first mode exists can leave CGDisplayCopyDisplayMode
                // returning NULL for the new display. Install the observer before acknowledging it.
                if (!observing) {
                    if (CGDisplayRegisterReconfigurationCallback(displayChanged, NULL) != kCGErrorSuccess) return 4;
                    observing = YES;
                }
                if (accepted) printf("screen %u %u %u %zu %zu\n", display.displayID, applied.w, applied.h, applied.pw, applied.ph);
                else puts("rejected");
                fflush(stdout);
            } @catch (NSException *exception) { return 5; } }
        }
        // The helper owns the only strong reference. EOF or process death removes the display.
        atomic_store(&monitorID, 0);
        dispatch_source_cancel(watch);
        if (observing) CGDisplayRemoveReconfigurationCallback(displayChanged, NULL);
        return 0;
    }
}
