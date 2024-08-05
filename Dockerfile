FROM ubuntu:latest

ENV HOST 0.0.0.0
EXPOSE 5443

RUN apt update && apt install curl libpq-dev clang llvm pkg-config nettle-dev libc6-dev libssl-dev -y

# Install YARN & Node
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | bash -s -- -y \
    && export PATH="$PATH:/root/.cargo/bin" \
    && rustup install 1.69.0  \
    && rustup default 1.69.0 

ENV PATH="/root/.cargo/bin:${PATH}"

ENV DATA_DIR="/data"
#ENV RUST_LOG="hoodik=debug,auth=debug,error=debug,entity=debug,storage=debug,context=debug,util=debug,cryptfns=debug,actix_web=debug"
#CMD /usr/local/bin/hoodik -a 0.0.0.0 -p 5443

