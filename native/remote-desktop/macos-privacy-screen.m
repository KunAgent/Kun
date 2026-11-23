#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <QuartzCore/QuartzCore.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <stdatomic.h>
#import <sys/event.h>
#import <unistd.h>

// This process owns both the curtain and its capture filter. WindowServer removes
// every panel if the helper dies, even when Electron cannot run its cleanup.
static CGDirectDisplayID target;
static BOOL virtualSource, visible;
static NSMutableDictionary<NSNumber *, NSPanel *> *panels;
static SCStream *stream;
static dispatch_queue_t pixels;
static CVPixelBufferRef latest;
static BOOL credit, ready;
static size_t width, height;
static atomic_ullong leaseUntil;

static double uptime(void) { return NSProcessInfo.processInfo.systemUptime; }
static void renew(unsigned ms) { atomic_store(&leaseUntil, (unsigned long long)(uptime() * 1000) + MIN(ms, 6000)); }
static OSStatus localExit(EventHandlerCallRef handler, EventRef event, void *context) { _exit(5); }

static void syncPanels(void) {
    if (!CGDisplayIsOnline(target) || (virtualSource && CGDisplayIsInMirrorSet(target))) _exit(10);
    NSMutableSet *obsolete = [NSMutableSet setWithArray:panels.allKeys];
    for (NSScreen *screen in NSScreen.screens) {
        NSNumber *number = screen.deviceDescription[@"NSScreenNumber"];
        if (!number || (virtualSource && number.unsignedIntValue == target)) continue;
#ifdef KUN_PRIVACY_TEST_DISPLAY
        // The native smoke binary may cover only its synthetic secondary display.
        if (number.unsignedIntValue != target) continue;
#endif
        [obsolete removeObject:number];
        NSPanel *panel = panels[number];
        if (!panel) {
            panel = [[NSPanel alloc] initWithContentRect:screen.frame
                styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
                backing:NSBackingStoreBuffered defer:NO];
            panel.releasedWhenClosed = NO;
            panel.hidesOnDeactivate = NO;
            panel.ignoresMouseEvents = YES;
            panel.hasShadow = NO;
            panel.opaque = YES;
            panel.backgroundColor = NSColor.blackColor;
            panel.animationBehavior = NSWindowAnimationBehaviorNone;
            panel.level = NSScreenSaverWindowLevel;
            panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces |
                NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorStationary |
                NSWindowCollectionBehaviorIgnoresCycle;
            // Order the helper into the shareable application list before capturing.
            // Alpha stays effectively transparent until the filtered track is attached.
            panel.alphaValue = visible ? 1 : 0.001;
            panels[number] = panel;
        }
        [panel setFrame:screen.frame display:NO];
        [panel orderFrontRegardless];
    }
    for (NSNumber *number in obsolete) { [panels[number] close]; [panels removeObjectForKey:number]; }
}

static void writeFrame(void) {
    if (!credit || !latest) return;
    CVPixelBufferRef image = latest; latest = NULL; credit = NO;
    if (CVPixelBufferLockBaseAddress(image, kCVPixelBufferLock_ReadOnly) != kCVReturnSuccess) _exit(11);
    NSMutableData *packet = [NSMutableData dataWithLength:width * height * 3 / 2];
    unsigned char *y = packet.mutableBytes, *u = y + width * height, *v = u + width * height / 4;
    const unsigned char *luma = CVPixelBufferGetBaseAddressOfPlane(image, 0);
    const unsigned char *chroma = CVPixelBufferGetBaseAddressOfPlane(image, 1);
    size_t yStride = CVPixelBufferGetBytesPerRowOfPlane(image, 0), uvStride = CVPixelBufferGetBytesPerRowOfPlane(image, 1);
    for (size_t row = 0; row < height; ++row) memcpy(y + row * width, luma + row * yStride, width);
    for (size_t row = 0; row < height / 2; ++row) {
        const unsigned char *line = chroma + row * uvStride;
        for (size_t x = 0; x < width / 2; ++x) { *u++ = line[2*x]; *v++ = line[2*x+1]; }
    }
    CVPixelBufferUnlockBaseAddress(image, kCVPixelBufferLock_ReadOnly);
    CVPixelBufferRelease(image);
    const char *bytes = packet.bytes;
    size_t left = packet.length;
    while (left) {
        ssize_t n = write(STDOUT_FILENO, bytes, left);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) _exit(12);
        bytes += n; left -= n;
    }
}

@interface KunPrivacyFrames : NSObject <SCStreamOutput, SCStreamDelegate>
@end
@implementation KunPrivacyFrames
- (void)stream:(SCStream *)sender didStopWithError:(NSError *)error {
#ifdef KUN_PRIVACY_TEST_DISPLAY
    dprintf(STDERR_FILENO, "Synthetic capture stopped: %s %ld %s\n", error.domain.UTF8String, (long)error.code, error.localizedDescription.UTF8String);
#endif
    _exit(13);
}
- (void)stream:(SCStream *)sender didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeScreen || !CMSampleBufferIsValid(sample)) return;
    NSArray *attachments = (__bridge NSArray *)CMSampleBufferGetSampleAttachmentsArray(sample, false);
    NSNumber *status = attachments.firstObject[SCStreamFrameInfoStatus];
    if (!status || status.integerValue == SCFrameStatusIdle || status.integerValue == SCFrameStatusStarted) return;
    if (status.integerValue != SCFrameStatusComplete) _exit(20 + (int)status.integerValue);
    CVPixelBufferRef image = CMSampleBufferGetImageBuffer(sample);
    if (!image) _exit(14);
    if (CVPixelBufferGetPixelFormatType(image) != kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange) _exit(15);
    if (CVPixelBufferGetWidth(image) != width || CVPixelBufferGetHeight(image) != height) _exit(16);
    if (CVPixelBufferGetPlaneCount(image) != 2) _exit(17);
    if (latest) CVPixelBufferRelease(latest);
    latest = CVPixelBufferRetain(image);
    if (!ready) { ready = YES; dprintf(3, "ready %zu %zu\n", width, height); }
    writeFrame();
}
@end

static void startCapture(unsigned tries) {
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO completionHandler:^(SCShareableContent *content, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (error || !content) _exit(3);
            SCDisplay *display = nil;
            SCRunningApplication *owner = nil;
            for (SCDisplay *item in content.displays) if (item.displayID == target) display = item;
            for (SCRunningApplication *app in content.applications) if (app.processID == getpid()) owner = app;
            if (!display || !owner) {
                if (!tries) _exit(3);
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{ startCapture(tries - 1); });
                return;
            }
            // Exclude exactly this helper. The user's Kun workbench remains visible
            // remotely, and new curtain windows on hot-plug are excluded automatically.
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingApplications:@[owner] exceptingWindows:@[]];
            CGDisplayModeRef mode = CGDisplayCopyDisplayMode(target);
            const size_t w = mode ? CGDisplayModeGetPixelWidth(mode) : display.width;
            const size_t h = mode ? CGDisplayModeGetPixelHeight(mode) : display.height;
            if (mode) CGDisplayModeRelease(mode);
            if (!w || !h) _exit(3);
            double scale = MIN(1.0, MIN(1920.0 / MAX(w,h), 1080.0 / MIN(w,h)));
            width = MAX(2, (size_t)(w * scale) & ~(size_t)1);
            height = MAX(2, (size_t)(h * scale) & ~(size_t)1);
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            config.width = width; config.height = height;
            config.pixelFormat = kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange;
            config.minimumFrameInterval = CMTimeMake(1,30);
            config.queueDepth = 3; config.showsCursor = YES;
            static KunPrivacyFrames *sink; sink = [KunPrivacyFrames new];
            stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:sink];
            NSError *failure = nil;
            if (![stream addStreamOutput:sink type:SCStreamOutputTypeScreen sampleHandlerQueue:pixels error:&failure]) _exit(3);
            [stream startCaptureWithCompletionHandler:^(NSError *failure) { if (failure) _exit(3); }];
        });
    }];
}

static void watchOwner(pid_t parent, pid_t renderer) {
    int queue = kqueue();
    if (parent <= 1 || queue < 0) _exit(2);
    struct kevent watches[2];
    EV_SET(&watches[0], parent, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
    EV_SET(&watches[1], renderer, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
    if (kevent(queue, watches, 2, NULL, 0, NULL) < 0 || getppid() != parent) _exit(2);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        struct kevent ev;
        while (kevent(queue, NULL, 0, &ev, 1, NULL) < 0 && errno == EINTR) {}
        _exit(0);
    });
    renew(6000);
    static dispatch_source_t timer;
    timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
    dispatch_source_set_timer(timer, DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC, 20 * NSEC_PER_MSEC);
    dispatch_source_set_event_handler(timer, ^{ if (uptime() * 1000 >= atomic_load(&leaseUntil)) _exit(0); });
    dispatch_resume(timer);
}

int kun_privacy_screen(uint32_t did, int32_t renderer, int isVirtual) {
    target = did; virtualSource = isVirtual != 0;
#ifdef KUN_PRIVACY_TEST_DISPLAY
    if (CGDisplayVendorNumber(did) != 0x4b55 || CGDisplayModelNumber(did) != 0x4d4f ||
        CGDisplayIsMain(did) || CGDisplayIsInMirrorSet(did)) return 2;
#endif
    watchOwner(getppid(), renderer);
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    EventTypeSpec keyEvent = { kEventClassKeyboard, kEventHotKeyPressed };
    EventHotKeyRef shortcut = NULL;
    if (InstallApplicationEventHandler(localExit, 1, &keyEvent, NULL, NULL) != noErr ||
        RegisterEventHotKey(kVK_ANSI_P, controlKey | optionKey | shiftKey, (EventHotKeyID){'KunP',1},
                            GetApplicationEventTarget(), 0, &shortcut) != noErr) return 4;
    panels = [NSMutableDictionary new];
    pixels = dispatch_queue_create("kun.privacy.frames", DISPATCH_QUEUE_SERIAL);
    [NSNotificationCenter.defaultCenter addObserverForName:NSApplicationDidChangeScreenParametersNotification object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { syncPanels(); }];
    syncPanels();
    if (virtualSource) dprintf(3, "ready 0 0\n");
    else startCapture(12);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        char line[40];
        while (fgets(line, sizeof(line), stdin)) {
            if (!strcmp(line, "frame\n")) { dispatch_async(pixels, ^{ credit = YES; writeFrame(); }); }
            else if (!strcmp(line, "show\n")) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    visible = YES; syncPanels();
                    for (NSPanel *p in panels.allValues) p.alphaValue = 1;
                    [CATransaction flush];
                    dprintf(3, "shown\n");
                });
            } else {
                unsigned ms; char extra;
                if (sscanf(line, "lease %u %c", &ms, &extra) != 1 || ms > 6000) _exit(2);
                renew(ms);
            }
        }
        _exit(0);
    });
    [NSApp run];
    return 0;
}
