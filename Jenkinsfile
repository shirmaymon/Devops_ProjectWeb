// Builds only the services whose folders changed (front/, flask/, auth/; common/ affects flask and auth),
// tests them, pushes them to Docker Hub and writes the new tag into the infra repo. Argo CD deploys it.

pipeline {
    agent {
    kubernetes {
      yaml '''
apiVersion: v1
kind: Pod
spec:
  containers:
    - name: dind
      image: docker:dind
      securityContext:
        privileged: true
      env:
        - name: DOCKER_TLS_CERTDIR
          value: ""
    - name: tools
      image: docker:cli
      command: ["cat"]
      tty: true
      env:
        - name: DOCKER_HOST
          value: tcp://localhost:2375
'''
    }
  }

  environment {
    DOCKERHUB_USER = 'shirmaymon'
    INFRA_REPO     = 'github.com/shirmaymon/Devops_Infra.git'
  }

  stages {

    // 1. Detect changes
    //    TAG      = the short commit hash, used as the image tag.
    //    SERVICES = the services whose folders changed since the last successful build.
    //    If we cannot tell what changed (first run, or the comparison fails), build all 3 services.
    stage('Detect changes') {
      steps {
        checkout scm
        script {
          env.TAG = sh(returnStdout: true, script: 'git rev-parse --short=7 HEAD').trim()
          env.SERVICES = sh(returnStdout: true, script: '''
            BASE="$GIT_PREVIOUS_SUCCESSFUL_COMMIT"
            if [ -n "$BASE" ] && git diff --name-only "$BASE" HEAD > changed.txt 2>/dev/null; then
              S=""
              grep -q '^front/' changed.txt && S="$S front"
              grep -qE '^(flask|common)/' changed.txt && S="$S flask"
              grep -qE '^(auth|common)/' changed.txt && S="$S auth"
            else
              S="front flask auth"
            fi
            echo $S
          ''').trim()
          echo "TAG=${env.TAG} SERVICES=[${env.SERVICES}]"
        }
      }
    }

    // 2. Prepare: tools, wait for the Docker engine, log in to Docker Hub.
    stage('Prepare') {
      when { expression { env.SERVICES?.trim() } }
      steps {
        container('tools') {
          sh 'apk add --no-cache git curl'
          sh 'for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 2; done'
          withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DH_USER', passwordVariable: 'DH_TOKEN')]) {
            sh 'echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin'
          }
        }
      }
    }

    // 3. Build: front uses the front/ folder as context, flask and auth use the repo root (they also copy common/).
    stage('Build') {
      when { expression { env.SERVICES?.trim() } }
      steps {
        container('tools') {
          sh '''
            for s in $SERVICES; do
              case $s in
                front) IMG=devops-front ;;
                flask) IMG=devops-backend ;;
                auth)  IMG=devops-auth ;;
              esac
              if [ "$s" = front ]; then
                docker build -t $DOCKERHUB_USER/$IMG:$TAG front
              else
                docker build -t $DOCKERHUB_USER/$IMG:$TAG -f $s/Dockerfile .
              fi
            done
          '''
        }
      }
    }

    // 4. Test: one stage per service, run in parallel. Each starts its own container and checks it over HTTP. A failing command stops the pipeline (failFast also stops the other tests).
    //    Frontend: /index.html must answer 200. Flask and auth: /healthz must answer 200, /readyz must answer 503 (no database in test env), and /metrics must show request counters after one request.
    stage('Test') {
      failFast true
      parallel {

        stage('Test front') {
          when { expression { (" " + env.SERVICES + " ").contains(" front ") } }
          steps {
            container('tools') {
              sh '''
                code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
                wait_for() { for i in $(seq 1 30); do [ "$(code $1)" != "000" ] && return 0; sleep 1; done; return 1; }

                docker run -d --name t-front -p 18080:80 $DOCKERHUB_USER/devops-front:$TAG
                wait_for http://localhost:18080/index.html
                test "$(code http://localhost:18080/index.html)" = "200"
              '''
            }
          }
        }

        stage('Test flask') {
          when { expression { (" " + env.SERVICES + " ").contains(" flask ") } }
          steps {
            container('tools') {
              sh '''
                code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
                wait_for() { for i in $(seq 1 30); do [ "$(code $1)" != "000" ] && return 0; sleep 1; done; return 1; }

                docker run -d --name t-flask -p 15000:5000 $DOCKERHUB_USER/devops-backend:$TAG
                wait_for http://localhost:15000/healthz
                test "$(code http://localhost:15000/healthz)" = "200"
                test "$(code http://localhost:15000/readyz)" = "503"
                code http://localhost:15000/api/files > /dev/null
                curl -s http://localhost:15000/metrics | grep -q http_requests_total
              '''
            }
          }
        }

        stage('Test auth') {
          when { expression { (" " + env.SERVICES + " ").contains(" auth ") } }
          steps {
            container('tools') {
              sh '''
                code() { curl -s -o /dev/null -w '%{http_code}' "$1"; }
                wait_for() { for i in $(seq 1 30); do [ "$(code $1)" != "000" ] && return 0; sleep 1; done; return 1; }

                docker run -d --name t-auth -p 15001:5001 $DOCKERHUB_USER/devops-auth:$TAG
                wait_for http://localhost:15001/healthz
                test "$(code http://localhost:15001/healthz)" = "200"
                test "$(code http://localhost:15001/readyz)" = "503"
                code http://localhost:15001/api/auth/me > /dev/null
                curl -s http://localhost:15001/metrics | grep -q http_requests_total
              '''
            }
          }
        }

      }
    }

    // 5. Push: only reached if the test passed.
    stage('Push') {
      when { expression { env.SERVICES?.trim() } }
      steps {
        container('tools') {
          sh '''
            for s in $SERVICES; do
              case $s in
                front) IMG=devops-front ;;
                flask) IMG=devops-backend ;;
                auth)  IMG=devops-auth ;;
              esac
              docker push $DOCKERHUB_USER/$IMG:$TAG
            done
          '''
        }
      }
    }

    // 6. Update infra: write the new tag into the Deployment file of each changed service and push. Argo CD does the rest.
    stage('Update infra') {
      when { expression { env.SERVICES?.trim() } }
      steps {
        container('tools') {
          withCredentials([usernamePassword(credentialsId: 'github-infra', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
            sh '''
              git clone --depth 1 https://$INFRA_REPO infra
              cd infra
              for s in $SERVICES; do
                case $s in
                  front) IMG=devops-front;   FILE=Frontend/apache-deployment.yml ;;
                  flask) IMG=devops-backend; FILE=Backend/Flask/flask-deployment.yml ;;
                  auth)  IMG=devops-auth;    FILE=Backend/Auth/auth-deployment.yml ;;
                esac
                sed -i -E "s|image: $DOCKERHUB_USER/$IMG:.*|image: $DOCKERHUB_USER/$IMG:$TAG|" $FILE
              done
              git config user.name jenkins
              git config user.email jenkins@vmcalc.local
              git commit -am "ci: update images ($SERVICES) to $TAG"
              git push https://$GH_USER:$GH_TOKEN@$INFRA_REPO HEAD:main
            '''
          }
        }
      }
    }
  }
}