/* Native playback owns decoding, audio output, clock and bounded frame queues.
 * Only stable public GStreamer/GLib ABI is used here. Keeping the declarations
 * local lets release builds use the runtime libraries already shipped in the
 * AppImage without requiring GStreamer development headers on the host. */
#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>

typedef int gboolean;
typedef int gint;
typedef unsigned int guint;
typedef unsigned int GQuark;
typedef int64_t gint64;
typedef uint64_t GstClockTime;
typedef struct _GstElement GstElement;
typedef struct _GstBus GstBus;
typedef struct _GstMessage GstMessage;
typedef struct _GstSample GstSample;
typedef struct _GstBuffer GstBuffer;
typedef struct _GstAppSink GstAppSink;
typedef struct _GError { GQuark domain; gint code; char *message; } GError;

enum { GST_STATE_NULL = 1, GST_STATE_PAUSED = 3, GST_STATE_PLAYING = 4 };
enum { GST_STATE_CHANGE_FAILURE = 0, GST_FORMAT_TIME = 3 };
enum { GST_SEEK_FLAG_FLUSH = 1 << 0, GST_SEEK_FLAG_ACCURATE = 1 << 1 };
enum { GST_MESSAGE_EOS = 1 << 0, GST_MESSAGE_ERROR = 1 << 1 };
#define GST_SECOND ((GstClockTime)1000000000)

extern gboolean gst_init_check(int *, char ***, GError **);
extern GstElement *gst_element_factory_make(const char *, const char *);
extern GstElement *gst_parse_bin_from_description(const char *, gboolean, GError **);
extern void *gst_object_ref_sink(void *);
extern void gst_object_unref(void *);
extern GstElement *gst_bin_get_by_name(void *, const char *);
extern GstBus *gst_element_get_bus(GstElement *);
extern gint gst_element_set_state(GstElement *, gint);
extern gint gst_element_get_state(GstElement *, gint *, gint *, GstClockTime);
extern gboolean gst_element_query_duration(GstElement *, gint, gint64 *);
extern gboolean gst_element_query_position(GstElement *, gint, gint64 *);
extern gboolean gst_element_seek_simple(GstElement *, gint, gint, gint64);
extern GstMessage *gst_bus_pop_filtered(GstBus *, guint);
extern void gst_message_parse_error(GstMessage *, GError **, char **);
extern void gst_mini_object_unref(void *);
extern GstBuffer *gst_sample_get_buffer(GstSample *);
extern size_t gst_buffer_get_size(GstBuffer *);
extern size_t gst_buffer_extract(GstBuffer *, size_t, void *, size_t);
extern GstSample *gst_app_sink_try_pull_sample(GstAppSink *, GstClockTime);
extern GstSample *gst_app_sink_try_pull_preroll(GstAppSink *, GstClockTime);
extern void g_object_set(void *, const char *, ...);
extern char *g_filename_to_uri(const char *, const char *, GError **);
extern char *g_strdup_printf(const char *, ...);
extern size_t g_strlcpy(char *, const char *, size_t);
extern void g_error_free(GError *);
extern void g_free(void *);

typedef struct { GstElement *pipeline, *sink; GstBus *bus; int playing; } Player;
static void copy_error(char *target, size_t size, const char *message) { g_strlcpy(target, message ? message : "Native media error", size); }
void rl_player_free(Player *p) {
  if (!p) return;
  gst_element_set_state(p->pipeline, GST_STATE_NULL);
  gst_object_unref(p->bus); gst_object_unref(p->sink); gst_object_unref(p->pipeline); free(p);
}
Player *rl_player_open(const char *path, int width, int height, char *error, size_t size) {
  GError *issue = NULL;
  if (!gst_init_check(NULL, NULL, &issue)) { copy_error(error,size,issue->message); g_error_free(issue); return NULL; }
  char *uri = g_filename_to_uri(path, NULL, &issue);
  if (!uri) { copy_error(error,size,issue->message); g_error_free(issue); return NULL; }
  GstElement *pipeline = gst_element_factory_make("playbin", NULL);
  char *description = g_strdup_printf("videoconvert ! videoscale ! video/x-raw,format=RGBA,width=%d,height=%d,pixel-aspect-ratio=1/1 ! appsink name=frames sync=true max-buffers=1 drop=true wait-on-eos=false", width,height);
  GstElement *video = gst_parse_bin_from_description(description, 1, &issue); g_free(description);
  if (!pipeline || !video || issue) {
    copy_error(error,size,issue ? issue->message : "Bundled native playback plugins are missing");
    if (issue) g_error_free(issue); if (video) gst_object_unref(video); if (pipeline) gst_object_unref(pipeline); g_free(uri); return NULL;
  }
  gst_object_ref_sink(video);
  gst_object_ref_sink(pipeline);
  GstElement *sink = gst_bin_get_by_name(video, "frames");
  g_object_set(pipeline, "uri",uri,"video-sink",video,NULL); g_free(uri); gst_object_unref(video);
  Player *p = calloc(1,sizeof(Player)); p->pipeline=pipeline;p->sink=sink;p->bus=gst_element_get_bus(pipeline);
  if (gst_element_set_state(pipeline,GST_STATE_PAUSED)==GST_STATE_CHANGE_FAILURE || gst_element_get_state(pipeline,NULL,NULL,5*GST_SECOND)==GST_STATE_CHANGE_FAILURE) {
    GstMessage *m=gst_bus_pop_filtered(p->bus,GST_MESSAGE_ERROR);
    if(m){gst_message_parse_error(m,&issue,NULL);copy_error(error,size,issue->message);g_error_free(issue);gst_mini_object_unref(m);}else copy_error(error,size,"Cannot prepare native decoder");
    rl_player_free(p);return NULL;
  }
  return p;
}
int rl_player_play(Player *p, int playing) {
  p->playing=playing;
  return gst_element_set_state(p->pipeline,playing?GST_STATE_PLAYING:GST_STATE_PAUSED)!=GST_STATE_CHANGE_FAILURE;
}
void rl_player_volume(Player *p, double volume) { g_object_set(p->pipeline,"volume",volume,NULL); }
int rl_player_seek(Player *p, double seconds) {
  gint64 duration=0;
  if(gst_element_query_duration(p->pipeline,GST_FORMAT_TIME,&duration)&&duration>0){double end=(double)duration/GST_SECOND-0.04;if(seconds<0.)seconds=0.;if(seconds>end)seconds=end;}
  return gst_element_seek_simple(p->pipeline,GST_FORMAT_TIME,GST_SEEK_FLAG_FLUSH|GST_SEEK_FLAG_ACCURATE,(gint64)(seconds*GST_SECOND));
}
double rl_player_position(Player *p) { gint64 time=0;gst_element_query_position(p->pipeline,GST_FORMAT_TIME,&time);return (double)time/GST_SECOND; }
int rl_player_status(Player *p,char *error,size_t size) {
  GstMessage *m=gst_bus_pop_filtered(p->bus,GST_MESSAGE_ERROR);
  if(m){GError *issue=NULL;gst_message_parse_error(m,&issue,NULL);copy_error(error,size,issue->message);g_error_free(issue);gst_mini_object_unref(m);return -1;}
  m=gst_bus_pop_filtered(p->bus,GST_MESSAGE_EOS);
  if(!m)return 0;
  gst_mini_object_unref(m);return 1;
}
/* Return a malloc-owned, tightly packed RGBA frame. Native queues retain only
 * one pending frame; the caller never downloads a growing event backlog. */
unsigned char *rl_player_frame(Player *p,int width,int height,double *pts) {
  GstSample *sample=p->playing?gst_app_sink_try_pull_sample((GstAppSink*)p->sink,0):gst_app_sink_try_pull_preroll((GstAppSink*)p->sink,0);
  if(!sample)return NULL;
  GstBuffer *buffer=gst_sample_get_buffer(sample);
  size_t length=(size_t)width*(size_t)height*4;
  unsigned char *result=NULL;
  if(gst_buffer_get_size(buffer)>=length){
    result=malloc(length);
    if(gst_buffer_extract(buffer,0,result,length)!=length){free(result);result=NULL;}
    else *pts=rl_player_position(p);
  }
  gst_mini_object_unref(sample);return result;
}
void rl_frame_free(unsigned char *frame){free(frame);}
