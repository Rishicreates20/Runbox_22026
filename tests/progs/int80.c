/* SV: 32-bit syscall via int 0x80 on x86_64 (arch-switch bypass attempt) */
int main(void){ long ret; __asm__ volatile("int $0x80":"=a"(ret):"a"(20)); return (int)ret & 0; }
