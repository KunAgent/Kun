#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>
#import <sys/event.h>
#import <unistd.h>
#import <signal.h>
#import <errno.h>

// This child receives only a locally approved display and the isolated renderer identity.
// A kqueue process watch also retires audio when the independent capture guard fires.
@interface KunSystemOutput : NSObject <SCStreamOutput, SCStreamDelegate>
@end
@implementation KunSystemOutput
- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error { _exit(3); }
- (void)stream:(SCStream *)stream didOutputSampleBuffer:(CMSampleBufferRef)sample ofType:(SCStreamOutputType)type {
    if (type != SCStreamOutputTypeAudio || !CMSampleBufferDataIsReady(sample)) return;
    const AudioStreamBasicDescription *format = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample));
    if (!format || format->mFormatID != kAudioFormatLinearPCM || !(format->mFormatFlags & kAudioFormatFlagIsFloat)
        || format->mBitsPerChannel != 32 || format->mChannelsPerFrame != 2 || format->mSampleRate != 48000) _exit(3);
    struct { AudioBufferList list; AudioBuffer extra; } buffers;
    CMBlockBufferRef retained = NULL;
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, NULL, &buffers.list, sizeof(buffers),
        NULL, NULL, kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment, &retained);
    if (status != noErr) _exit(3);
    CMItemCount frames = CMSampleBufferGetNumSamples(sample);
    if (frames > 0 && frames <= 8192) {
        NSMutableData *packet = [NSMutableData dataWithLength:frames * 2 * sizeof(float)];
        float *pcm = packet.mutableBytes;
        const AudioBuffer *a = buffers.list.mBuffers;
        if (buffers.list.mNumberBuffers == 1 && a[0].mDataByteSize >= packet.length)
            memcpy(pcm, a[0].mData, packet.length);
        else if (buffers.list.mNumberBuffers == 2 && a[0].mDataByteSize >= frames*4 && a[1].mDataByteSize >= frames*4) {
            const float *left = a[0].mData, *right = a[1].mData;
            for (CMItemCount i=0; i<frames; i++) { pcm[2*i]=left[i]; pcm[2*i+1]=right[i]; }
        } else _exit(3);
        const char *bytes = packet.bytes;
        size_t remaining = packet.length;
        while (remaining) {
            ssize_t n = write(STDOUT_FILENO, bytes, remaining);
            if (n < 0 && errno == EINTR) continue;
            if (n <= 0) _exit(3);
            remaining -= n; bytes += n;
        }
    }
    if (retained) CFRelease(retained);
}
@end

int kun_system_audio(uint32_t displayID, int32_t renderer) {
    int queue = kqueue();
    if (queue < 0 || getppid() <= 1) return 2;
    struct kevent watches[2];
    EV_SET(&watches[0], renderer, EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
    EV_SET(&watches[1], getppid(), EVFILT_PROC, EV_ADD, NOTE_EXIT, 0, NULL);
    if (kevent(queue, watches, 2, NULL, 0, NULL) < 0) return 2;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        struct kevent event;
        while (kevent(queue, NULL, 0, &event, 1, NULL) < 0 && errno == EINTR) {}
        _exit(0);
    });
    static SCStream *owner;
    static KunSystemOutput *output;
    [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES
        completionHandler:^(SCShareableContent *content, NSError *failure) {
            SCDisplay *selected = nil;
            for (SCDisplay *display in content.displays) if (display.displayID == displayID) selected = display;
            if (!selected || failure) _exit(2);
            SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:selected excludingWindows:@[]];
            SCStreamConfiguration *config = [SCStreamConfiguration new];
            config.capturesAudio = YES; config.sampleRate = 48000; config.channelCount = 2;
            config.excludesCurrentProcessAudio = YES;
            config.width = 2; config.height = 2; config.minimumFrameInterval = CMTimeMake(1,1);
            output = [KunSystemOutput new];
            owner = [[SCStream alloc] initWithFilter:filter configuration:config delegate:output];
            NSError *error = nil;
            if (![owner addStreamOutput:output type:SCStreamOutputTypeAudio sampleHandlerQueue:dispatch_queue_create("kun.system-output", NULL) error:&error]) _exit(2);
            [owner startCaptureWithCompletionHandler:^(NSError *error) {
                if (error || write(3, "R", 1) != 1) _exit(3);
            }];
        }];
    dispatch_main();
}
