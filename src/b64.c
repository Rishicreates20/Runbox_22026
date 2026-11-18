#include <stdlib.h>
#include <string.h>
#include "runbox.h"

static const char B64[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

static int b64_val(unsigned char c)
{
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (c == '+' || c == '-') return 62; /* accept url-safe too */
    if (c == '/' || c == '_') return 63;
    return -1;
}

unsigned char *b64_decode(const char *in, size_t in_len, size_t *out_len)
{
    unsigned char *out = malloc(in_len / 4 * 3 + 4);
    if (!out) return NULL;
    uint32_t acc = 0;
    int bits = 0, pad = 0;
    size_t o = 0;
    for (size_t i = 0; i < in_len; i++) {
        unsigned char c = (unsigned char)in[i];
        if (c == ' ' || c == '\n' || c == '\r' || c == '\t') continue;
        if (c == '=') { pad++; continue; }
        if (pad) { free(out); return NULL; } /* data after padding */
        int v = b64_val(c);
        if (v < 0) { free(out); return NULL; }
        acc = (acc << 6) | (uint32_t)v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (unsigned char)(acc >> bits);
        }
    }
    if (pad > 2) { free(out); return NULL; }
    *out_len = o;
    return out;
}

char *b64_encode(const unsigned char *in, size_t n)
{
    size_t olen = (n + 2) / 3 * 4;
    char *out = malloc(olen + 1);
    if (!out) return NULL;
    size_t o = 0, i = 0;
    while (i + 2 < n) {
        uint32_t v = (uint32_t)in[i] << 16 | (uint32_t)in[i + 1] << 8 | in[i + 2];
        out[o++] = B64[(v >> 18) & 63];
        out[o++] = B64[(v >> 12) & 63];
        out[o++] = B64[(v >> 6) & 63];
        out[o++] = B64[v & 63];
        i += 3;
    }
    if (i < n) {
        uint32_t v = (uint32_t)in[i] << 16;
        if (i + 1 < n) v |= (uint32_t)in[i + 1] << 8;
        out[o++] = B64[(v >> 18) & 63];
        out[o++] = B64[(v >> 12) & 63];
        out[o++] = (i + 1 < n) ? B64[(v >> 6) & 63] : '=';
        out[o++] = '=';
    }
    out[o] = 0;
    return out;
}

size_t normalize_newlines(unsigned char *buf, size_t len)
{
    size_t w = 0;
    for (size_t r = 0; r < len; r++) {
        if (buf[r] == '\r' && r + 1 < len && buf[r + 1] == '\n')
            continue; /* drop CR of CRLF */
        buf[w++] = buf[r];
    }
    return w;
}
