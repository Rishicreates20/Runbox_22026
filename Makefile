CC      ?= cc
CFLAGS  ?= -O2 -g
CFLAGS  += -std=gnu11 -Wall -Wextra -Wno-unused-result -Wno-format-truncation -D_FORTIFY_SOURCE=2 -fstack-protector-strong
LDFLAGS ?=

SRC = src/runbox.c src/cgroup.c src/seccomp.c src/b64.c
BIN = runbox

all: $(BIN)

$(BIN): $(SRC) src/runbox.h
	$(CC) $(CFLAGS) -o $@ $(SRC) $(LDFLAGS)

test: $(BIN)
	sudo python3 tests/run_tests.py

clean:
	rm -f $(BIN)
	rm -rf tests/build

.PHONY: all test clean
