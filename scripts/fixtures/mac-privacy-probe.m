#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <unistd.h>

extern int kun_privacy_screen(uint32_t, int32_t, int);
static void pixel(CGDirectDisplayID did, dispatch_semaphore_t done) {
    [SCShareableContent getShareableContentExcludingDesktopWindows:NO onScreenWindowsOnly:NO
        completionHandler:^(SCShareableContent *content, NSError *error) {
        SCDisplay *selected = nil;
        for (SCDisplay *display in content.displays) if (display.displayID == did) selected = display;
        if (!selected || error) _exit(2);
        SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:selected excludingWindows:@[]];
        SCStreamConfiguration *config = [SCStreamConfiguration new];
        config.width = 64; config.height = 64; config.showsCursor = NO;
        [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image, NSError *failure) {
            if (!image || failure) _exit(3);
            uint8_t pixels[64*64*4];
            CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
            CGContextRef ctx = CGBitmapContextCreate(pixels, 64, 64, 8, 64*4, space, (CGBitmapInfo)kCGImageAlphaNoneSkipLast);
            CGContextDrawImage(ctx, CGRectMake(0,0,64,64), image);
            uint8_t *p = pixels + (32*64+32)*4;
            dprintf(STDOUT_FILENO, "%u %u %u\n", p[0], p[1], p[2]);
            CGContextRelease(ctx); CGColorSpaceRelease(space); dispatch_semaphore_signal(done);
        }];
    }];
}


int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc > 2 && (!strcmp(argv[1],"--pixel") || !strcmp(argv[1],"--privacy-screen"))) {
            CGDirectDisplayID did = (CGDirectDisplayID)strtoul(argv[2], NULL, 10);
            if (CGDisplayVendorNumber(did) != 0x4b55 || CGDisplayModelNumber(did) != 0x4d4f ||
                CGDisplayIsMain(did) || CGDisplayIsInMirrorSet(did)) return 2;
            if (argc == 3 && !strcmp(argv[1],"--pixel")) {
                dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
                    char line[16];
                    while (fgets(line, sizeof(line), stdin)) {
                        if (strcmp(line,"pixel\n")) _exit(2);
                        dispatch_semaphore_t done = dispatch_semaphore_create(0);
                        pixel(did, done);
                        if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 4*NSEC_PER_SEC))) _exit(3);
                    }
                    _exit(0);
                });
                dispatch_main();
            }
            if (argc == 6 && !strcmp(argv[1],"--privacy-screen")) return kun_privacy_screen(did, atoi(argv[3]), 0);
            return 2;
        }
        NSString *shipped = [[NSString stringWithUTF8String:argv[0]] stringByAppendingString:@".shipped"];
        execv(shipped.fileSystemRepresentation, argv);
        return 2;
    }
}
