'use strict';

angular.module('copayApp.controllers').controller('walletHomeController', function(
  $scope, $rootScope, $timeout, $filter, $modal, $log, notification, txStatus,
  isCordova, profileService, lodash, configService, rateService, storageService,
  bitcore, isChromeApp, gettext, gettextCatalog, nodeWebkit, addressService,
  addressParser, bitIDService, onChainService, go) {

  var self = this;
  $rootScope.hideMenuBar = false;
  $rootScope.wpInputFocused = false;

  // INIT
  var config = configService.getSync().wallet.settings;
  this.unitToSatoshi = config.unitToSatoshi;
  this.satToUnit = 1 / this.unitToSatoshi;
  this.unitName = config.unitName;
  this.alternativeIsoCode = config.alternativeIsoCode;
  this.alternativeName = config.alternativeName;
  this.alternativeAmount = 0;
  this.unitDecimals = config.unitDecimals;
  this.isCordova = isCordova;
  this.addresses = [];
  this.isWindowsPhoneApp = isMobile.Windows() && isCordova;
  this.blockUx = false;
  this.isRateAvailable = false;
  this.showScanner = false;
  this.isMobile = isMobile.any();
  this.addr = {};

  var disableScannerListener = $rootScope.$on('dataScanned', function(event, data) {

    if (addressParser.isBitID(data) === true) {
      self.setOngoingProcess('Preparing BitID Authentication');
      bitIDService.setAddress(data);
      go.bitID();
    } else if(addressParser.isOnChain(data) === true) {
      onChainService.setAddress(data);
      //TODO Show confirmation dialog before executing each command
      if(onChainService.getParsed().cmd == 'mpk') {
        var serviceUrl = onChainService.getParsed().service;
        self.confirmDialog('Share your Master Public Key with '+serviceUrl+'?', function(confirmed){
          if(confirmed) {
            self.setOngoingProcess('Sharing Master Public Key with '+serviceUrl);
            var req = onChainService.processMPK();
            req.then(function(data, status, headers, config) {
              alert('Master Public Key shared');
              self.setOngoingProcess();
            }, function(data, status, headers, config) {
              alert('Error sharing Master Public Key');
              self.setOngoingProcess();
            });
          }
      });
      } else if(onChainService.getParsed().cmd == 'sign') {
        var serviceUrl = onChainService.getParsed().service;
        self.confirmDialog('Sign the transaction with '+serviceUrl+'?', function(confirmed){
          if(confirmed) {
            self.setOngoingProcess('Signing transaction with '+serviceUrl);
            var txReq = onChainService.getTransaction();
            txReq.then(function(data, status, headers, config) {
              var txHex = onChainService.signTransaction(data.data);
              var postReq = onChainService.postSignedRequest(txHex);
              postReq.then(function(pData, pStatus, pHeaders, pConfig) {
                alert('Transaction signed');
                self.setOngoingProcess();
              }, function(pData, pStatus, pHeaders, pConfig) {
                alert('Error posting signed transaction');
                self.setOngoingProcess();
              });
            }, function(data, status, headers, config) {
              alert('Error getting transaction');
              self.setOngoingProcess();
            });
          }
        });
      }
    } else {
      go.send();
      self.setForm(data);
      $rootScope.$emit('Local/SetTab', 'send');
    }
  });

  var disablePaymentUriListener = $rootScope.$on('paymentUri', function(event, uri) {
    $timeout(function() {
      $rootScope.$emit('Local/SetTab', 'send');
      self.setForm(uri);
    }, 100);
  });

  var disableAddrListener = $rootScope.$on('Local/NeedNewAddress', function() {
    self.setAddress(true);
  });

  var disableFocusListener = $rootScope.$on('Local/NewFocusedWallet', function() {
    self.addr = {};
    self.resetForm();
  });

  var disableResumeListener = $rootScope.$on('Local/Resume', function() {
    // This is needed then the apps go to sleep
    self.bindTouchDown();
  });

  var disableTabListener = $rootScope.$on('Local/TabChanged', function(e, tab) {
    // This will slow down switch, do not add things here!
    switch (tab) {
      case 'receive':
        // just to be sure we have an address
        self.setAddress();
        break;
      case 'send':
        self.resetError();
    };
  });

  $scope.$on('$destroy', function() {
    disableAddrListener();
    disableScannerListener();
    disablePaymentUriListener();
    disableTabListener();
    disableFocusListener();
    disableResumeListener();
    $rootScope.hideMenuBar = false;
  });

  rateService.whenAvailable(function() {
    self.isRateAvailable = true;
    $rootScope.$digest();
  });

  // walletHome


  var parseError = function(err) {
    if (!err) return;

    if (err.message) {
      // TODO : this is not used anymore?
      if (err.message.indexOf('CORS') >= 0) {
        err.message = gettext('Could not connect wallet service. Check your Internet connexion and your wallet service configuration.');
      }

      if (err.message.indexOf('TIMEDOUT') >= 0) {
        err.message = gettext('Wallet service timed out. Check your Internet connexion and your wallet service configuration.');
      }
    }
  };

  $scope.openCopayersModal = function(copayers, copayerId) {
    var fc = profileService.focusedClient;

    var ModalInstanceCtrl = function($scope, $modalInstance) {
      $scope.copayers = copayers;
      $scope.copayerId = copayerId;
      $scope.color = fc.backgroundColor;
      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
    };
    var modalInstance = $modal.open({
      templateUrl: 'views/modals/copayers.html',
      windowClass: 'full animated slideInUp',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('slideOutDown');
    });
  };


  $scope.openWalletsModal = function(wallets) {

    var ModalInstanceCtrl = function($scope, $modalInstance) {
      $scope.wallets = wallets;
      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };

      $scope.selectWallet = function(walletId, walletName) {
        $scope.gettingAddress = true;
        $scope.selectedWalletName = walletName;
        $timeout(function() {
          $scope.$apply();
        });
        addressService.getAddress(walletId, false, function(err, addr) {
          $scope.gettingAddress = false;
          if (!err || addr)
            $modalInstance.close(addr);
          else {
            parseError(err);
            self.error = err;
            $modalInstance.dismiss('cancel');
          }
        });
      };
    };

    var modalInstance = $modal.open({
      templateUrl: 'views/modals/wallets.html',
      windowClass: 'full animated slideInUp',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('slideOutDown');
    });

    modalInstance.result.then(function(addr) {
      if (addr) {
        self.setForm(addr);
      }
    });
  };

  this.openTxpModal = function(tx, copayers) {
    var fc = profileService.focusedClient;
    var refreshUntilItChanges = false;
    var ModalInstanceCtrl = function($scope, $modalInstance) {
      $scope.error = null;
      $scope.tx = tx;
      $scope.amountStr = tx.amountStr;
      $scope.feeStr = tx.feeStr;
      $scope.alternativeAmountStr = tx.alternativeAmountStr;
      $scope.copayers = copayers
      $scope.copayerId = fc.credentials.copayerId;
      $scope.loading = null;
      $scope.color = fc.backgroundColor;
      refreshUntilItChanges = false;

      $scope.getShortNetworkName = function() {
        return fc.credentials.networkName.substring(0, 4);
      };
      lodash.each(['TxProposalRejectedBy', 'TxProposalAcceptedBy', 'transactionProposalRemoved', 'TxProposalRemoved', 'NewOutgoingTx'], function(eventName) {
        $rootScope.$on(eventName, function() {
          fc.getTx($scope.tx.id, function(err, tx) {
            if (err) {

              if (err.code && err.code == 'BADREQUEST' &&
                (eventName == 'transactionProposalRemoved' || eventName == 'TxProposalRemoved')) {
                $scope.tx.removed = true;
                $scope.tx.canBeRemoved = false;
                $scope.tx.pendingForUs = false;
                $scope.$apply();
                return;
              }
              return;
            }

            var action = lodash.find(tx.actions, {
              copayerId: fc.credentials.copayerId
            });
            $scope.tx = tx;
            if (!action && tx.status == 'pending')
              $scope.tx.pendingForUs = true;
            $scope.updateCopayerList();
            $scope.$apply();
          });
        });
      });

      $scope.updateCopayerList = function() {
        lodash.map($scope.copayers, function(cp) {
          lodash.each($scope.tx.actions, function(ac) {
            if (cp.id == ac.copayerId) {
              cp.action = ac.type;
            }
          });
        });
      };

      $scope.sign = function(txp) {
        var fc = profileService.focusedClient;
        if (fc.isPrivKeyEncrypted()) {
          profileService.unlockFC(function(err) {
            if (err) {
              parseError(err);
              $scope.error = err;
              return;
            }
            return $scope.sign(txp);
          });
          return;
        };

        self.setOngoingProcess(gettext('Signing payment'));
        $scope.loading = true;
        $scope.error = null;
        $timeout(function() {
          fc.signTxProposal(txp, function(err, txpsi) {
            profileService.lockFC();
            self.setOngoingProcess();
            if (err) {
              $scope.loading = false;
              parseError(err);
              $scope.error = err.message || gettext('Could not accept payment. Check you connection and try again');
              $scope.$digest();
            } else {
              //if txp has required signatures then broadcast it
              var txpHasRequiredSignatures = txpsi.status == 'accepted';
              if (txpHasRequiredSignatures) {
                self.setOngoingProcess(gettext('Broadcasting transaction'));
                $scope.loading = true;
                fc.broadcastTxProposal(txpsi, function(err, txpsb, memo) {
                  self.setOngoingProcess();
                  $scope.loading = false;
                  if (err) {
                    parseError(err);
                    $scope.error = gettext('Could not broadcast payment. Check you connection and try again');
                    $scope.$digest();
                  } else {
                    $log.debug('Transaction signed and broadcasted')
                    if (memo)
                      $log.info(memo);

                    refreshUntilItChanges = true;
                    $modalInstance.close(txpsb);
                  }
                });
              } else {
                $scope.loading = false;
                $modalInstance.close(txpsi);
              }
            }
          });
        }, 100);
      };

      $scope.reject = function(txp) {
        self.setOngoingProcess(gettext('Rejecting payment'));
        $scope.loading = true;
        $scope.error = null;
        $timeout(function() {
          fc.rejectTxProposal(txp, null, function(err, txpr) {
            self.setOngoingProcess();
            $scope.loading = false;
            if (err) {
              parseError(err);
              $scope.error = err.message || gettext('Could not reject payment. Check you connection and try again');
              $scope.$digest();
            } else {
              $modalInstance.close(txpr);
            }
          });
        }, 100);
      };


      $scope.remove = function(txp) {
        self.setOngoingProcess(gettext('Deleting payment'));
        $scope.loading = true;
        $scope.error = null;
        $timeout(function() {
          fc.removeTxProposal(txp, function(err, txpb) {
            self.setOngoingProcess();
            $scope.loading = false;

            // Hacky: request tries to parse an empty response
            if (err && !(err.message && err.message.match(/Unexpected/))) {
              parseError(err);
              $scope.error = err.message || gettext('Could not delete payment proposal. Check you connection and try again');
              $scope.$digest();
              return;
            }
            $modalInstance.close();
          });
        }, 100);
      };

      $scope.broadcast = function(txp) {
        self.setOngoingProcess(gettext('Broadcasting Payment'));
        $scope.loading = true;
        $scope.error = null;
        $timeout(function() {
          fc.broadcastTxProposal(txp, function(err, txpb, memo) {
            self.setOngoingProcess();
            $scope.loading = false;
            if (err) {
              parseError(err);
              $scope.error = err.message || gettext('Could not broadcast payment. Check you connection and try again');
              $scope.$digest();
            } else {

              if (memo)
                $log.info(memo);

              refreshUntilItChanges = true;
              $modalInstance.close(txpb);
            }
          });
        }, 100);
      };

      $scope.copyAddress = function(addr) {
        if (!addr) return;
        self.copyAddress(addr);
      };

      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
    };

    var modalInstance = $modal.open({
      templateUrl: 'views/modals/txp-details.html',
      windowClass: 'full animated slideInRight',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('slideOutRight');
    });

    modalInstance.result.then(function(txp) {
      self.setOngoingProcess();
      if (txp) {
        txStatus.notify(txp, function() {
          $scope.$emit('Local/TxProposalAction', refreshUntilItChanges);
        });
      } else {
        $timeout(function() {
          $scope.$emit('Local/TxProposalAction', refreshUntilItChanges);
        }, 100);
      }
    });

  };

  this.setAddress = function(forceNew) {
    self.addrError = null;
    var fc = profileService.focusedClient;
    if (!fc)
      return;

    // Address already set?
    if (!forceNew && self.addr[fc.credentials.walletId]) {
      return;
    }

    self.generatingAddress = true;
    $timeout(function() {
      addressService.getAddress(fc.credentials.walletId, forceNew, function(err, addr) {
        self.generatingAddress = false;

        if (err) {
          parseError(err);
          self.addrError = err.message || gettext('Could not create address. Check you connection and try again');
        }

        if (addr)
          self.addr[fc.credentials.walletId] = addr;

        $scope.$digest();
      });
    });
  };

  this.copyAddress = function(addr) {
    if (isCordova) {
      window.cordova.plugins.clipboard.copy(addr);
      window.plugins.toast.showShortCenter('Copied to clipboard');
    } else if (nodeWebkit.isDefined()) {
      nodeWebkit.writeToClipboard(addr);
    }
  };

  this.shareAddress = function(addr) {
    if (isCordova) {
      if (isMobile.Android() || isMobile.Windows()) {
        window.ignoreMobilePause = true;
      }
      window.plugins.socialsharing.share('bitcoin:' + addr, null, null, null);
    }
  };

  this.openCustomizedAmountModal = function(addr) {
    var self = this;
    var fc = profileService.focusedClient;
    var ModalInstanceCtrl = function($scope, $modalInstance) {
      $scope.addr = addr;
      $scope.color = fc.backgroundColor;
      $scope.unitName = self.unitName;
      $scope.alternativeAmount = self.alternativeAmount;
      $scope.alternativeName = self.alternativeName;
      $scope.alternativeIsoCode = self.alternativeIsoCode;
      $scope.isRateAvailable = self.isRateAvailable;
      $scope.unitToSatoshi = self.unitToSatoshi;
      $scope.unitDecimals = self.unitDecimals;
      var satToUnit = 1 / self.unitToSatoshi;
      $scope.showAlternative = false;

      Object.defineProperty($scope,
        "_customAlternative", {
          get: function() {
            return $scope.customAlternative;
          },
          set: function(newValue) {
            $scope.customAlternative = newValue;
            if (typeof(newValue) === 'number' && $scope.isRateAvailable) {
              $scope.customAmount = parseFloat((rateService.fromFiat(newValue, $scope.alternativeIsoCode) * satToUnit).toFixed($scope.unitDecimals), 10);
            }
          },
          enumerable: true,
          configurable: true
        });

      Object.defineProperty($scope,
        "_customAmount", {
          get: function() {
            return $scope.customAmount;
          },
          set: function(newValue) {
            $scope.customAmount = newValue;
            if (typeof(newValue) === 'number' && $scope.isRateAvailable) {
              $scope.customAlternative = parseFloat((rateService.toFiat(newValue * $scope.unitToSatoshi, $scope.alternativeIsoCode)).toFixed(2), 10);
            } else {
              $scope.customAlternative = 0;
            }
            $scope.alternativeAmount = $scope.customAlternative;
          },
          enumerable: true,
          configurable: true
        });

      $scope.submitForm = function(form) {
        var satToBtc = 1 / 100000000;
        var amount = form.amount.$modelValue;
        var amountSat = parseInt((amount * $scope.unitToSatoshi).toFixed(0));
        $timeout(function() {
          $scope.customizedAmountUnit = amount + ' ' + $scope.unitName;
          $scope.customizedAlternativeUnit = $filter('noFractionNumber')(form.alternative.$modelValue, 2) + ' ' + $scope.alternativeIsoCode;
          if ($scope.unitName == 'bits') {
            amount = (amountSat * satToBtc).toFixed(8);
          }
          $scope.customizedAmountBtc = amount;
        }, 1);
      };

      $scope.toggleAlternative = function() {
        $scope.showAlternative = !$scope.showAlternative;
      };

      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
    };

    var modalInstance = $modal.open({
      templateUrl: 'views/modals/customized-amount.html',
      windowClass: 'full animated slideInUp',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('slideOutDown');
    });
  };

  // Send

  this.canShowAlternative = function() {
    return $scope.showAlternative;
  };

  this.showAlternative = function() {
    $scope.showAlternative = true;
  };

  this.hideAlternative = function() {
    $scope.showAlternative = false;
  };

  this.resetError = function() {
    this.error = this.success = null;
  };

  this.bindTouchDown = function(tries) {
    var self = this;
    tries = tries || 0;
    if (tries > 5) return;
    var e = document.getElementById('menu-walletHome');
    if (!e) return $timeout(function() {
      self.bindTouchDown(++tries);
    }, 500);

    // on touchdown elements
    $log.debug('Binding touchstart elements...');
    ['hamburger', 'menu-walletHome', 'menu-send', 'menu-receive', 'menu-history'].forEach(function(id) {
      var e = document.getElementById(id);
      if (e) e.addEventListener('touchstart', function() {
        try {
          event.preventDefault();
        } catch (e) {};
        angular.element(e).triggerHandler('click');
      }, true);
    });
  }

  this.hideMenuBar = lodash.debounce(function(hide) {
    if (hide) {
      $rootScope.hideMenuBar = true;
      this.bindTouchDown();
    } else {
      $rootScope.hideMenuBar = false;
    }
    $rootScope.$digest();
  }, 100);


  this.formFocus = function(what) {
    if (isCordova && !this.isWindowsPhoneApp) {
      this.hideMenuBar(what);
    }
    if (!this.isWindowsPhoneApp) return

    if (!what) {
      this.hideAddress = false;
      this.hideAmount = false;

    } else {
      if (what == 'amount') {
        this.hideAddress = true;
      } else if (what == 'msg') {
        this.hideAddress = true;
        this.hideAmount = true;
      }
    }
    $timeout(function() {
      $rootScope.$digest();
    }, 1);
  };

  this.setSendFormInputs = function() {
    var unitToSat = this.unitToSatoshi;
    var satToUnit = 1 / unitToSat;
    /**
     * Setting the two related amounts as properties prevents an infinite
     * recursion for watches while preserving the original angular updates
     *
     */
    Object.defineProperty($scope,
      "_alternative", {
        get: function() {
          return $scope.__alternative;
        },
        set: function(newValue) {
          $scope.__alternative = newValue;
          if (typeof(newValue) === 'number' && self.isRateAvailable) {
            $scope._amount = parseFloat((rateService.fromFiat(newValue, self.alternativeIsoCode) * satToUnit).toFixed(self.unitDecimals), 10);
          }
        },
        enumerable: true,
        configurable: true
      });
    Object.defineProperty($scope,
      "_amount", {
        get: function() {
          return $scope.__amount;
        },
        set: function(newValue) {
          $scope.__amount = newValue;
          if (typeof(newValue) === 'number' && self.isRateAvailable) {
            $scope.__alternative = parseFloat((rateService.toFiat(newValue * self.unitToSatoshi, self.alternativeIsoCode)).toFixed(2), 10);
          } else {
            $scope.__alternative = 0;
          }
          self.alternativeAmount = $scope.__alternative;
          self.resetError();
        },
        enumerable: true,
        configurable: true
      });

    Object.defineProperty($scope,
      "_address", {
        get: function() {
          return $scope.__address;
        },
        set: function(newValue) {
          $scope.__address = self.onAddressChange(newValue);
        },
        enumerable: true,
        configurable: true
      });
  };

  this.setSendError = function(err) {
    var fc = profileService.focusedClient;
    $log.warn(err);
    parseError(err);
    var errMessage =
      fc.credentials.m > 1 ? gettext('Could not create payment proposal') : gettext('Could not send payment');

    //This are abnormal situations, but still err message will not be translated
    //(the should) we should switch using err.code and use proper gettext messages
    errMessage = errMessage + '. ' + (err.message ? err.message : gettext('Check you connection and try again'));

    this.error = errMessage;

    $timeout(function() {
      $scope.$digest();
    }, 1);
  };


  this.setOngoingProcess = function(name) {
    var self = this;
    self.blockUx = !!name;

    if (isCordova) {
      if (name) {
        window.plugins.spinnerDialog.hide();
        window.plugins.spinnerDialog.show(null, name + '...', true);
      } else {
        window.plugins.spinnerDialog.hide();
      }
    } else {
      self.onGoingProcess = name;
      $timeout(function() {
        $rootScope.$apply();
      });
    };
  };

  this.submitForm = function() {
    var fc = profileService.focusedClient;
    var unitToSat = this.unitToSatoshi;

    var form = $scope.sendForm;
    if (form.$invalid) {
      this.error = gettext('Unable to send transaction proposal');
      return;
    }

    if (fc.isPrivKeyEncrypted()) {
      profileService.unlockFC(function(err) {
        if (err) return self.setSendError(err);
        return self.submitForm();
      });
      return;
    };

    self.setOngoingProcess(gettext('Creating transaction'));
    $timeout(function() {
      var comment = form.comment.$modelValue;
      var paypro = self._paypro;
      var address, amount;

      address = form.address.$modelValue;
      amount = parseInt((form.amount.$modelValue * unitToSat).toFixed(0));

      fc.sendTxProposal({
        toAddress: address,
        amount: amount,
        message: comment,
        payProUrl: paypro ? paypro.url : null,
        feePerKb: config.feeValue || 10000,
      }, function(err, txp) {
        if (err) {
          self.setOngoingProcess();
          profileService.lockFC();
          return self.setSendError(err);
        }

        self.signAndBroadcast(txp, function(err) {
          self.setOngoingProcess();
          profileService.lockFC();
          self.resetForm();
          if (err) {
            self.error = err.message ? err.message : gettext('The payment was created but could not be completed. Please try again from home screen');
            $scope.$emit('Local/TxProposalAction');
            $timeout(function() {
              $scope.$digest();
            }, 1);
          }
        });
      });
    }, 100);
  };


  this.signAndBroadcast = function(txp, cb) {
    var fc = profileService.focusedClient;
    self.setOngoingProcess(gettext('Signing transaction'));
    fc.signTxProposal(txp, function(err, signedTx) {
      profileService.lockFC();
      self.setOngoingProcess();
      if (err) {
        err.message = gettext('The payment was created but could not be signed. Please try again from home screen.') + (err.message ? ' ' + err.message : '');
        return cb(err);
      }

      if (signedTx.status == 'accepted') {
        self.setOngoingProcess(gettext('Broadcasting transaction'));
        fc.broadcastTxProposal(signedTx, function(err, btx, memo) {
          self.setOngoingProcess();
          if (err) {
            err.message = gettext('The payment was signed but could not be broadcasted. Please try again from home screen.') + (err.message ? ' ' + err.message : '');
            return cb(err);
          }
          if (memo)
            $log.info(memo);

          txStatus.notify(btx, function() {
            $scope.$emit('Local/TxProposalAction', true);
            return cb();
          });
        });
      } else {
        self.setOngoingProcess();
        txStatus.notify(signedTx, function() {
          $scope.$emit('Local/TxProposalAction');
          return cb();
        });
      }
    });
  };

  this.setForm = function(to, amount, comment) {
    var form = $scope.sendForm;
    if (to) {
      form.address.$setViewValue(to);
      form.address.$isValid = true;
      form.address.$render();
      this.lockAddress = true;
    }

    if (amount) {
      form.amount.$setViewValue("" + amount);
      form.amount.$isValid = true;
      form.amount.$render();
      this.lockAmount = true;
    }

    if (comment) {
      form.comment.$setViewValue(comment);
      form.comment.$isValid = true;
      form.comment.$render();
    }
  };



  this.resetForm = function() {
    this.resetError();
    this._paypro = null;

    this.lockAddress = false;
    this.lockAmount = false;

    this._amount = this._address = null;

    var form = $scope.sendForm;
    if (form && form.amount) {
      form.amount.$pristine = true;
      form.amount.$setViewValue('');
      form.amount.$render();

      form.comment.$setViewValue('');
      form.comment.$render();
      form.$setPristine();

      if (form.address) {
        form.address.$pristine = true;
        form.address.$setViewValue('');
        form.address.$render();
      }
    }
    $timeout(function() {
      $rootScope.$digest();
    }, 1);
  };

  this.openPPModal = function(paypro) {
    var ModalInstanceCtrl = function($scope, $modalInstance) {
      var fc = profileService.focusedClient;
      var satToUnit = 1 / self.unitToSatoshi;
      $scope.paypro = paypro;
      $scope.alternative = self.alternativeAmount;
      $scope.alternativeIsoCode = self.alternativeIsoCode;
      $scope.isRateAvailable = self.isRateAvailable;
      $scope.unitTotal = (paypro.amount * satToUnit).toFixed(self.unitDecimals);
      $scope.unitName = self.unitName;
      $scope.color = fc.backgroundColor;

      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
    };
    var modalInstance = $modal.open({
      templateUrl: 'views/modals/paypro.html',
      windowClass: 'full animated slideInUp',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('slideOutDown');
    });
  };

  this.setFromPayPro = function(uri) {
    var fc = profileService.focusedClient;
    if (isChromeApp) {
      this.error = gettext('Payment Protocol not supported on Chrome App');
      return;
    }

    var satToUnit = 1 / this.unitToSatoshi;
    var self = this;
    /// Get information of payment if using Payment Protocol
    self.setOngoingProcess(gettext('Fetching Payment Information'));

    $log.debug('Fetch PayPro Request...', uri);
    $timeout(function() {
      fc.fetchPayPro({
        payProUrl: uri,
      }, function(err, paypro) {
        self.setOngoingProcess();

        if (err) {
          $log.warn(err);
          self.resetForm();
          var msg = err.toString();
          if (msg.match('HTTP')) {
            msg = gettext('Could not fetch payment information');
          }
          self.error = msg;
        } else {
          self._paypro = paypro;
          self.setForm(paypro.toAddress, (paypro.amount * satToUnit).toFixed(self.unitDecimals),
            paypro.memo);
        }
      });
    }, 1);
  };

  this.setFromUri = function(uri) {
    function sanitizeUri(uri) {
      // Fixes when a region uses comma to separate decimals
      var regex = /[\?\&]amount=(\d+([\,\.]\d+)?)/i;
      var match = regex.exec(uri);
      if (!match || match.length === 0) {
        return uri;
      }
      var value = match[0].replace(',', '.');
      var newUri = uri.replace(regex, value);
      return newUri;
    };

    var satToUnit = 1 / this.unitToSatoshi;

    uri = sanitizeUri(uri);

    if (!bitcore.URI.isValid(uri)) {
      return uri;
    }
    var parsed = new bitcore.URI(uri);
    var addr = parsed.address.toString();
    var message = parsed.message;
    if (parsed.r)
      return this.setFromPayPro(parsed.r);

    var amount = parsed.amount ?
      (parsed.amount.toFixed(0) * satToUnit).toFixed(this.unitDecimals) : 0;

    this.setForm(addr, amount, message);
    return addr;
  };

  this.onAddressChange = function(value) {
    this.resetError();
    if (!value) return '';

    if (this._paypro)
      return value;

    if (value.indexOf('bitcoin:') === 0) {
      return this.setFromUri(value);
    } else if (/^https?:\/\//.test(value)) {
      return this.setFromPayPro(value);
    } else {
      return value;
    }
  };


  // History

  function strip(number) {
    return (parseFloat(number.toPrecision(12)));
  }

  this.getUnitName = function() {
    return this.unitName;
  };

  this.getAlternativeIsoCode = function() {
    return this.alternativeIsoCode;
  };

  this._addRates = function(txs, cb) {
    if (!txs || txs.length == 0) return cb();
    var index = lodash.groupBy(txs, 'rateTs');

    rateService.getHistoricRates(config.alternativeIsoCode, lodash.keys(index), function(err, res) {
      if (err || !res) return cb(err);
      lodash.each(res, function(r) {
        lodash.each(index[r.ts], function(tx) {
          var alternativeAmount = (r.rate != null ? tx.amount * rateService.SAT_TO_BTC * r.rate : null);
          tx.alternativeAmount = alternativeAmount ? $filter('noFractionNumber')(alternativeAmount, 2) : null;
        });
      });
      return cb();
    });
  };

  this.openTxModal = function(btx) {
    var self = this;
    var fc = profileService.focusedClient;
    var ModalInstanceCtrl = function($scope, $modalInstance) {
      $scope.btx = btx;
      $scope.settings = config;
      $scope.color = fc.backgroundColor;
      $scope.copayerId = fc.credentials.copayerId;
      $scope.isShared = fc.credentials.n > 1;

      $scope.getAmount = function(amount) {
        return self.getAmount(amount);
      };

      $scope.getUnitName = function() {
        return self.getUnitName();
      };

      $scope.getShortNetworkName = function() {
        var n = fc.credentials.network;
        return n.substring(0, 4);
      };

      $scope.copyAddress = function(addr) {
        if (!addr) return;
        self.copyAddress(addr);
      };

      $scope.cancel = function() {
        $modalInstance.dismiss('cancel');
      };
    };

    var modalInstance = $modal.open({
      templateUrl: 'views/modals/tx-details.html',
      windowClass: 'full animated slideInRight',
      controller: ModalInstanceCtrl,
    });

    modalInstance.result.finally(function() {
      var m = angular.element(document.getElementsByClassName('reveal-modal'));
      m.addClass('slideOutRight');
    });
  };

  this.hasAction = function(actions, action) {
    return actions.hasOwnProperty('create');
  };

  this._doSendAll = function(amount) {
    this.setForm(null, amount);
  };

  this.confirmDialog = function(msg, cb) {
    if (isCordova) {
      navigator.notification.confirm(
        msg,
        function(buttonIndex) {
          if (buttonIndex == 1) {
            $timeout(function() {
              return cb(true);
            }, 1);
          } else {
            return cb(false);
          }
        }
      );
    } else if (isChromeApp) {
      // No feedback, alert/confirm not supported.
      return cb(true);
    } else {
      return cb(confirm(msg));
    }
  };

  this.sendAll = function(amount, feeStr) {
    var self = this;
    var msg = gettextCatalog.getString("{{fee}} will be discounted for bitcoin networking fees", {
      fee: feeStr
    });

    this.confirmDialog(msg, function(confirmed){
      if (confirmed)
        self._doSendAll(amount);
    });
  }

  /* Start setup */

  this.bindTouchDown();
  this.setAddress();
  this.setSendFormInputs();
});
